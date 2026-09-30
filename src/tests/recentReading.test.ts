import { describe, expect, it } from "vitest";
import {
  RECENT_PAGE_SIZE,
  createRecentReadingQuery,
  normalizeRecentReadingPreferences,
} from "../recent/recentReading";

describe("recent reading preferences", () => {
  it("normalizes persisted view, sort, and filter conservatively", () => {
    expect(normalizeRecentReadingPreferences({})).toEqual({
      view: "list",
      sort: "recent",
      filter: "all",
    });
    expect(
      normalizeRecentReadingPreferences({
        "recent.view": "grid",
        "recent.sort": "progress",
        "recent.filter": "7days",
      }),
    ).toEqual({ view: "grid", sort: "progress", filter: "7days" });
  });

  it("creates bounded paginated queries without persisting search text", () => {
    const query = createRecentReadingQuery(
      { view: "grid", sort: "title", filter: "unfinished" },
      "  orchard  ",
      160,
    );
    expect(query).toEqual({
      search: "orchard",
      sort: "title",
      filter: "unfinished",
      limit: RECENT_PAGE_SIZE,
      offset: 160,
      timezoneOffsetMinutes: expect.any(Number),
    });
  });
});
