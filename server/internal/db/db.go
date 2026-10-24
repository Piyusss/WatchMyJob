// Package db connects to DynamoDB: Amazon's, or DynamoDB Local (in Docker,
// for development and the tests) when an endpoint is given. The table
// itself is defined in package store, which does all the reading and
// writing.
package db

import (
	"context"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/ratelimit"
	"github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"jobdrop/internal/metrics"
)

// Connect returns a client for DynamoDB in region. The SDK reads the AWS
// keys itself, from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
func Connect(ctx context.Context, region, endpoint string) (*dynamodb.Client, error) {
	options := []func(*config.LoadOptions) error{
		config.WithRegion(region),
		// The table has the free tier's small, fixed capacity (see
		// store/table.go), so a burst of requests can be throttled. Instead
		// of failing after the SDK's usual 3 tries, the client slows itself
		// down ("adaptive" mode) and tries up to 10 times. Throttling is
		// expected here, not a sign of an outage, so there's no retry budget.
		config.WithRetryer(func() aws.Retryer {
			return retry.NewAdaptiveMode(func(o *retry.AdaptiveModeOptions) {
				o.StandardOptions = append(o.StandardOptions, func(o *retry.StandardOptions) {
					o.MaxAttempts = 10
					o.MaxBackoff = 20 * time.Second
					o.RateLimiter = ratelimit.None
				})
			})
		}),
	}
	if endpoint != "" && os.Getenv("AWS_ACCESS_KEY_ID") == "" {
		// DynamoDB Local takes any keys, but the SDK won't send a request without some.
		options = append(options, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider("local", "local", "")))
	}
	cfg, err := config.LoadDefaultConfig(ctx, options...)
	if err != nil {
		return nil, err
	}
	return dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
			// DynamoDB Local's responses don't always carry the checksum
			// AWS's do, and the SDK would log a warning for each.
			o.DisableValidateResponseChecksum = true
		}
		o.APIOptions = append(o.APIOptions, metrics.DynamoDB)
	}), nil
}
