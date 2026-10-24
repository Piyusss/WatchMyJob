package store

// The table's layout. DynamoDB finds an item only by its key, and can't
// join, count or group, so the keys are designed around how the app reads
// its data rather than around the data's shape (one table holds every
// kind of item: "single-table design").
//
// Every item has a partition key (PK) and a sort key (SK). Items with the
// same PK are stored together, in SK order, and one Query reads them, so
// what the app reads together shares a PK:
//
//	item              PK                SK
//	company           COMPANIES         <slug>
//	role families     ROLES             <company slug>
//	job               COMPANY#<slug>    JOB#<external id>
//	test job          COMPANY#<slug>    TESTJOB#<id>
//	test job pointer  TESTJOB#<id>      TESTJOB
//	user              USER#<user id>    PROFILE
//	preferences       USER#<user id>    PREFS
//	subscription      USER#<user id>    SUB#<company slug>
//	mark              USER#<user id>    MARK#<job id>
//	notification      USER#<user id>    NOTIF#<job id>
//
// The keys are ids the app already treats as unique and permanent: a
// company's slug (companies.json is matched by it), a user's Clerk user id
// (which every request carries), and a job's id on its board. A key is
// unique, so "write this only if its key is free" stands in for a unique
// constraint, and the keys make some lookups free:
//   - A job's id is made from its key (model.JobID), so finding a job by its
//     id, or a user's saved jobs, is a direct read, with no index.
//   - All the companies are one partition, a few hundred small items, read
//     whole when the app needs a list. Their open jobs' role families (job
//     titles without the level: hundreds for a big company) are another,
//     read whole for the role dropdown. They're kept off the company item
//     because a write costs as much as the whole item is big, and every
//     sync round writes each company's "last checked" time.
//   - A company's jobs are one partition, which the sync reads to compare
//     with the board.
//   - Everything a user owns is in their partition, so deleting an account
//     is one Query and a batch of deletes: there's no "on delete cascade".
//   - A test job's pointer leads from its id (all the admin pages' URLs
//     have) to its company.
//
// Two global secondary indexes (GSIs) answer the questions the keys can't.
// An index is a copy of the items that have its key attributes, keyed by
// those. An item without them isn't in it, so each index holds just the
// items it's for (a "sparse" index), and an item leaves it by losing them:
//
//	GSI1 (keys only)   GSI1PK            GSI1SK
//	user               UNSUB#<token>     USER#<id>    a user, by unsubscribe token
//	subscription       COMPANY#<slug>    USER#<id>    a company's watchers
//
//	GSI2 (all fields)  GSI2PK            GSI2SK
//	job, while open    OPEN#<slug>       <first seen>#<external id>    a company's open jobs
//	email, while       QUEUED            <created>#<notification id>   the emails waiting to be
//	  queued                                                             sent, oldest first
//
// DynamoDB updates an index a moment after the table, so a read from one
// may not see a write that just finished. Reads from an index are only
// used where that doesn't matter; every read that a write depends on goes
// to the table, strongly consistent.

const (
	gsi1 = "GSI1"
	gsi2 = "GSI2"
)

const (
	companiesPartition = "COMPANIES"
	rolesPartition     = "ROLES"
)

func companyKey(slug string) key {
	return key{companiesPartition, slug}
}

func roleFamiliesKey(companySlug string) key {
	return key{rolesPartition, companySlug}
}

func companyPartition(slug string) string {
	return "COMPANY#" + slug
}

func jobKey(companySlug, externalID string) key {
	return key{companyPartition(companySlug), "JOB#" + externalID}
}

func testJobKey(companySlug, id string) key {
	return key{companyPartition(companySlug), "TESTJOB#" + id}
}

func testJobPointerKey(id string) key {
	return key{"TESTJOB#" + id, "TESTJOB"}
}

func userPartition(userID string) string {
	return "USER#" + userID
}

func profileKey(userID string) key {
	return key{userPartition(userID), "PROFILE"}
}

func preferencesKey(userID string) key {
	return key{userPartition(userID), "PREFS"}
}

func subscriptionKey(userID, companySlug string) key {
	return key{userPartition(userID), "SUB#" + companySlug}
}

func markKey(userID, jobID string) key {
	return key{userPartition(userID), "MARK#" + jobID}
}

func notificationKey(userID, jobID string) key {
	return key{userPartition(userID), "NOTIF#" + jobID}
}
