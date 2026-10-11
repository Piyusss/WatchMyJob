package api

// after is "load more" paging, for the job feed and the alert history: it
// returns the page that follows the cursor. The cursor is the id of the
// last item on the previous page; the next page starts right after it. An
// unknown cursor starts again from the top. The next cursor is nil on the
// last page.
func after[T any](all []T, cursor string, size int, idOf func(T) string) ([]T, *string) {
	start := 0
	for i, item := range all {
		if cursor != "" && idOf(item) == cursor {
			start = i + 1
			break
		}
	}
	end := min(start+size, len(all))
	page := all[start:end]
	if end == len(all) {
		return page, nil
	}
	next := idOf(page[len(page)-1])
	return page, &next
}
