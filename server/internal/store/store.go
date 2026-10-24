// Package store is every read and write the app makes to DynamoDB, one
// file per kind of item. keys.go explains the table's layout: what each
// item's keys are, and why. table.go defines the table itself.
package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"golang.org/x/sync/errgroup"
)

// DB is the app's DynamoDB table, plus caches of what the website reads
// most (see cache.go).
type DB struct {
	client *dynamodb.Client
	table  string
	open   *cache[[]jobItem] // company slug → its open jobs
	roles  *cache[[]string]  // "" → every role family on an open job
}

func New(client *dynamodb.Client, table string) *DB {
	return &DB{client: client, table: table, open: newCache[[]jobItem](), roles: newCache[[]string]()}
}

// key is an item's primary key: its partition key and its sort key.
type key struct{ PK, SK string }

func (k key) attributes() map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: k.PK},
		"SK": &types.AttributeValueMemberS{Value: k.SK},
	}
}

// keyOf reads the key of an item as DynamoDB returned it.
func keyOf(item map[string]types.AttributeValue) key {
	var k key
	_ = attributevalue.UnmarshalMap(item, &k) // every item has its key
	return k
}

// get reads the item with key k into out, and reports false if there's
// none. Like every read of the table here, it's strongly consistent: it
// sees every write that finished before it.
func (d *DB) get(ctx context.Context, k key, out any) (bool, error) {
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &d.table, Key: k.attributes(), ConsistentRead: aws.Bool(true),
	})
	if err != nil || result.Item == nil {
		return false, err
	}
	return true, attributevalue.UnmarshalMap(result.Item, out)
}

// put writes item, replacing any item with the same key. With a condition,
// the write only happens if it holds; conditionFailed tells that apart.
func (d *DB) put(ctx context.Context, item any, condition string) error {
	attributes, err := attributevalue.MarshalMap(item)
	if err != nil {
		return err
	}
	input := &dynamodb.PutItemInput{TableName: &d.table, Item: attributes}
	if condition != "" {
		input.ConditionExpression = &condition
	}
	_, err = d.client.PutItem(ctx, input)
	return err
}

// update changes the item with key k as expression says, e.g. "SET #name =
// :name REMOVE GSI2PK". Like SQL's UPDATE, it does nothing if there's no
// such item (UpdateItem on its own would create one).
func (d *DB) update(ctx context.Context, k key, expression string, vals map[string]any) error {
	input := &dynamodb.UpdateItemInput{
		TableName:                &d.table,
		Key:                      k.attributes(),
		UpdateExpression:         &expression,
		ConditionExpression:      aws.String("attribute_exists(PK)"),
		ExpressionAttributeNames: names(expression),
	}
	if len(vals) > 0 {
		input.ExpressionAttributeValues = values(vals)
	}
	_, err := d.client.UpdateItem(ctx, input)
	if conditionFailed(err) {
		return nil
	}
	return err
}

// delete removes the item with key k, and reports whether there was one.
func (d *DB) delete(ctx context.Context, k key) (bool, error) {
	result, err := d.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &d.table, Key: k.attributes(), ReturnValues: types.ReturnValueAllOld,
	})
	if err != nil {
		return false, err
	}
	return len(result.Attributes) > 0, nil
}

// conditionFailed reports whether a write didn't happen because its
// condition didn't hold, e.g. "only if no item has this key yet".
func conditionFailed(err error) bool {
	var failed *types.ConditionalCheckFailedException
	return errors.As(err, &failed)
}

// query returns every item a Query finds. DynamoDB answers a page (up to
// 1 MB) at a time; this asks for the next page until there are no more.
func query[T any](ctx context.Context, d *DB, input *dynamodb.QueryInput) ([]T, error) {
	input.TableName = &d.table
	found := []T{}
	pages := dynamodb.NewQueryPaginator(d.client, input)
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		var items []T
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &items); err != nil {
			return nil, err
		}
		found = append(found, items...)
	}
	return found, nil
}

// inPartition is a Query for the items in partition pk whose sort keys
// start with prefix ("" for all of them: a key condition can't hold an
// empty string).
func inPartition(pk, prefix string) *dynamodb.QueryInput {
	input := &dynamodb.QueryInput{
		KeyConditionExpression:    aws.String("PK = :pk"),
		ExpressionAttributeValues: values(map[string]any{":pk": pk}),
		ConsistentRead:            aws.Bool(true),
	}
	if prefix != "" {
		input.KeyConditionExpression = aws.String("PK = :pk AND begins_with(SK, :prefix)")
		input.ExpressionAttributeValues = values(map[string]any{":pk": pk, ":prefix": prefix})
	}
	return input
}

// inIndex is a Query for the items in one partition of a secondary index
// (index "GSI1" is keyed by GSI1PK and GSI1SK, and so on). An index can't
// be read with strong consistency (see keys.go).
func inIndex(index, pk string) *dynamodb.QueryInput {
	return &dynamodb.QueryInput{
		IndexName:                 aws.String(index),
		KeyConditionExpression:    aws.String(index + "PK = :pk"),
		ExpressionAttributeValues: values(map[string]any{":pk": pk}),
	}
}

// count is how many items a Query finds, without reading them out.
func count(ctx context.Context, d *DB, input *dynamodb.QueryInput) (int, error) {
	input.TableName = &d.table
	input.Select = types.SelectCount
	n := 0
	pages := dynamodb.NewQueryPaginator(d.client, input)
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return 0, err
		}
		n += int(page.Count)
	}
	return n, nil
}

// batchGet reads the items with the given keys, 100 per request (the most
// BatchGetItem takes). Keys with no item are left out, and the items come
// back in no particular order.
func batchGet[T any](ctx context.Context, d *DB, keys []key) ([]T, error) {
	items, err := d.batchGetItems(ctx, keys)
	if err != nil {
		return nil, err
	}
	found := []T{}
	return found, attributevalue.UnmarshalListOfMaps(items, &found)
}

// batchGetItems is batchGet for items of more than one kind, which the
// caller tells apart by their keys (keyOf).
func (d *DB) batchGetItems(ctx context.Context, keys []key) ([]map[string]types.AttributeValue, error) {
	var found []map[string]types.AttributeValue
	for chunk := range slices.Chunk(unique(keys), 100) {
		keys := make([]map[string]types.AttributeValue, len(chunk))
		for i, k := range chunk {
			keys[i] = k.attributes()
		}
		request := map[string]types.KeysAndAttributes{d.table: {Keys: keys, ConsistentRead: aws.Bool(true)}}
		err := untilDone(ctx, func() (bool, error) {
			result, err := d.client.BatchGetItem(ctx, &dynamodb.BatchGetItemInput{RequestItems: request})
			if err != nil {
				return false, err
			}
			found = append(found, result.Responses[d.table]...)
			request = result.UnprocessedKeys
			return len(request) == 0, nil
		})
		if err != nil {
			return nil, err
		}
	}
	return found, nil
}

// batchDelete deletes the items with the given keys, 25 per request (the
// most BatchWriteItem takes).
func (d *DB) batchDelete(ctx context.Context, keys []key) error {
	for chunk := range slices.Chunk(unique(keys), 25) {
		var deletes []types.WriteRequest
		for _, k := range chunk {
			deletes = append(deletes, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: k.attributes()}})
		}
		request := map[string][]types.WriteRequest{d.table: deletes}
		err := untilDone(ctx, func() (bool, error) {
			result, err := d.client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{RequestItems: request})
			if err != nil {
				return false, err
			}
			request = result.UnprocessedItems
			return len(request) == 0, nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// untilDone repeats a batch request until it reports nothing left. A batch
// request succeeds even when the table only got to part of it (when it's
// out of capacity, say), returning the rest, which is tried again after a
// growing pause.
func untilDone(ctx context.Context, attempt func() (bool, error)) error {
	pause := 50 * time.Millisecond
	for range 10 {
		done, err := attempt()
		if done || err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pause):
		}
		pause = min(2*pause, 5*time.Second)
	}
	return errors.New("DynamoDB still hadn't processed the whole batch after 10 tries")
}

// unique drops repeated keys: a batch request with the same key twice is refused.
func unique(keys []key) []key {
	seen := map[key]bool{}
	var kept []key
	for _, k := range keys {
		if !seen[k] {
			seen[k] = true
			kept = append(kept, k)
		}
	}
	return kept
}

// inParallel runs do on each item, at most limit at a time, and returns the
// first error. Requests to DynamoDB are cheap but each waits on the
// network, so running a few at once is much faster than one by one.
func inParallel[T any](ctx context.Context, items []T, limit int, do func(context.Context, T) error) error {
	group, ctx := errgroup.WithContext(ctx)
	group.SetLimit(limit)
	for _, item := range items {
		group.Go(func() error { return do(ctx, item) })
	}
	return group.Wait()
}

var placeholder = regexp.MustCompile(`#\w+`)

// names lists the attribute names an expression refers to as #name.
// DynamoDB reserves hundreds of words (name, status, url, level, ...), so
// an expression names every attribute this way rather than risk one.
func names(expression string) map[string]string {
	found := map[string]string{}
	for _, name := range placeholder.FindAllString(expression, -1) {
		found[name] = name[1:]
	}
	if len(found) == 0 {
		return nil
	}
	return found
}

// values marshals the values an expression refers to as :value. Only plain
// values (strings, numbers, times, lists of them) are ever passed, which
// always marshal, so a failure is a bug.
func values(vals map[string]any) map[string]types.AttributeValue {
	marshalled, err := attributevalue.MarshalMap(vals)
	if err != nil {
		panic(fmt.Sprintf("marshalling expression values: %v", err))
	}
	return marshalled
}

// sortTime writes t so that times sort as text, for a sort key. It has a
// fixed width: time.RFC3339Nano drops trailing zeros, and "05.1Z" would
// sort after "05.12Z".
func sortTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000000Z")
}

// orEmpty turns a missing list into an empty one, which the website reads as [].
func orEmpty[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}
