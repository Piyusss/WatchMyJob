import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlToText } from "./htmlText.js";

describe("htmlToText", () => {
  it("handles Greenhouse's real shape: entity-escaped HTML tags, not literal ones", () => {
    // Confirmed against a real fetched Figma description: the stored string
    // literally contains "&lt;div..." not "<div...". A naive tag-stripper
    // that only looks for literal "<" would leave the escaped tags in the
    // output untouched.
    const raw = "&lt;div class=&quot;x&quot;&gt;&lt;p&gt;Hello world&lt;/p&gt;&lt;/div&gt;";
    assert.equal(htmlToText(raw), "Hello world");
  });

  it("turns block tags into line breaks so section structure survives", () => {
    const raw = "&lt;h4&gt;What you should have&lt;/h4&gt;&lt;ul&gt;&lt;li&gt;5+ years&lt;/li&gt;&lt;/ul&gt;";
    const text = htmlToText(raw);
    assert.ok(text.includes("What you should have\n5+ years"), `expected a line break, got: ${JSON.stringify(text)}`);
  });

  it("decodes entities that are part of the visible text, not just the markup", () => {
    const raw = "&lt;p&gt;Design &amp; build products you&#39;ll love&lt;/p&gt;";
    assert.equal(htmlToText(raw), "Design & build products you'll love");
  });

  it("returns an empty string for null input", () => {
    assert.equal(htmlToText(null), "");
  });

  it("collapses repeated blank lines from consecutive block tags", () => {
    const raw = "&lt;p&gt;A&lt;/p&gt;&lt;p&gt;&lt;/p&gt;&lt;p&gt;B&lt;/p&gt;";
    const text = htmlToText(raw);
    assert.equal(text, "A\nB");
  });
});
