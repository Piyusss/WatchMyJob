package store

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// capacity is what the table and its indexes may use per second: a read
// unit reads up to 4 KB (8 KB if it may be a moment behind), a write unit
// writes up to 1 KB. AWS's free tier includes 25 of each for good, shared
// by every table and index, so these add up to exactly that and the table
// costs nothing. (Billed per request instead, "on demand", it would cost
// cents a month, but never nothing.) A burst above them spends what went
// unused over the last five minutes; past that, DynamoDB refuses requests
// until capacity frees up, and the client retries them, slower (see
// db.Connect). The sync, which reads and writes the most, writes to the
// table and GSI2; the website mostly reads the table.
var capacity = map[string]types.ProvisionedThroughput{
	"":   {ReadCapacityUnits: aws.Int64(15), WriteCapacityUnits: aws.Int64(12)}, // the table
	gsi1: {ReadCapacityUnits: aws.Int64(2), WriteCapacityUnits: aws.Int64(3)},
	gsi2: {ReadCapacityUnits: aws.Int64(8), WriteCapacityUnits: aws.Int64(10)},
}

// EnsureTable creates the table if there isn't one yet, as the keys.go
// layout needs it, and waits until it can be used. protect turns on
// deletion protection, so the AWS table can't be deleted by mistake (it's
// off for DynamoDB Local).
func (d *DB) EnsureTable(ctx context.Context, protect bool) error {
	_, err := d.client.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &d.table})
	var missing *types.ResourceNotFoundException
	if !errors.As(err, &missing) {
		return err // nil: it exists
	}

	slog.Info("Creating the DynamoDB table", "table", d.table)
	attribute := func(name string) types.AttributeDefinition {
		return types.AttributeDefinition{AttributeName: aws.String(name), AttributeType: types.ScalarAttributeTypeS}
	}
	keys := func(partition, sort string) []types.KeySchemaElement {
		return []types.KeySchemaElement{
			{AttributeName: aws.String(partition), KeyType: types.KeyTypeHash},
			{AttributeName: aws.String(sort), KeyType: types.KeyTypeRange},
		}
	}
	throughput := func(index string) *types.ProvisionedThroughput {
		units := capacity[index]
		return &units
	}
	input := &dynamodb.CreateTableInput{
		TableName: &d.table,
		// Only key attributes are declared: DynamoDB doesn't fix the others.
		AttributeDefinitions: []types.AttributeDefinition{
			attribute("PK"), attribute("SK"), attribute("GSI1PK"), attribute("GSI1SK"),
			attribute("GSI2PK"), attribute("GSI2SK"),
		},
		KeySchema:             keys("PK", "SK"),
		BillingMode:           types.BillingModeProvisioned,
		ProvisionedThroughput: throughput(""),
		GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{
			{
				IndexName: aws.String(gsi1),
				KeySchema: keys("GSI1PK", "GSI1SK"),
				// Its lookups only need to find the items: a read of the
				// table then gets them, strongly consistent.
				Projection:            &types.Projection{ProjectionType: types.ProjectionTypeKeysOnly},
				ProvisionedThroughput: throughput(gsi1),
			},
			{
				IndexName: aws.String(gsi2),
				KeySchema: keys("GSI2PK", "GSI2SK"),
				// The open jobs are read from it as they are.
				Projection:            &types.Projection{ProjectionType: types.ProjectionTypeAll},
				ProvisionedThroughput: throughput(gsi2),
			},
		},
	}
	if protect {
		input.DeletionProtectionEnabled = aws.Bool(true)
	}
	_, err = d.client.CreateTable(ctx, input)
	var creating *types.ResourceInUseException
	if err != nil && !errors.As(err, &creating) { // in use: another server is creating it
		return err
	}
	return dynamodb.NewTableExistsWaiter(d.client).Wait(ctx,
		&dynamodb.DescribeTableInput{TableName: &d.table}, 5*time.Minute)
}
