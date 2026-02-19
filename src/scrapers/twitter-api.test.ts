import { describe, it, expect } from "vitest";
import { parseTweets } from "./twitter-api";
import type { RawResponse } from "./twitter-api";

describe("parseTweets", () => {
  it("returns [] when raw.data is missing", () => {
    const raw: RawResponse = {};
    expect(parseTweets(raw)).toEqual([]);
  });

  it("returns [] when raw.data is a plain object (non-array)", () => {
    const raw: RawResponse = { data: {} as any };
    expect(parseTweets(raw)).toEqual([]);
  });

  it("returns [] when raw.data is null", () => {
    const raw: RawResponse = { data: null as any };
    expect(parseTweets(raw)).toEqual([]);
  });

  it("defaults username to '?' when no includes.users", () => {
    const raw: RawResponse = {
      data: [
        {
          id: "1",
          text: "hello",
          author_id: "u1",
          created_at: "2026-01-01T00:00:00Z",
          conversation_id: "1",
          public_metrics: { like_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0, impression_count: 0, bookmark_count: 0 },
        },
      ],
    };
    const tweets = parseTweets(raw);
    expect(tweets).toHaveLength(1);
    expect(tweets[0].username).toBe("?");
    expect(tweets[0].name).toBe("?");
  });

  it("resolves username and name from includes.users", () => {
    const raw: RawResponse = {
      data: [
        {
          id: "2",
          text: "hi",
          author_id: "u2",
          created_at: "2026-01-02T00:00:00Z",
          conversation_id: "2",
          public_metrics: {},
        },
      ],
      includes: {
        users: [{ id: "u2", username: "alice", name: "Alice Smith" }],
      },
    };
    const tweets = parseTweets(raw);
    expect(tweets[0].username).toBe("alice");
    expect(tweets[0].name).toBe("Alice Smith");
  });

  it("maps entities.urls to tweet.urls", () => {
    const raw: RawResponse = {
      data: [
        {
          id: "3",
          text: "check this",
          author_id: "u3",
          created_at: "2026-01-03T00:00:00Z",
          conversation_id: "3",
          public_metrics: {},
          entities: {
            urls: [
              { expanded_url: "https://example.com/tool" },
              { expanded_url: "https://github.com/foo/bar" },
            ],
          },
        },
      ],
    };
    const tweets = parseTweets(raw);
    expect(tweets[0].urls).toEqual([
      "https://example.com/tool",
      "https://github.com/foo/bar",
    ]);
  });

  it("maps entities.hashtags to tweet.hashtags", () => {
    const raw: RawResponse = {
      data: [
        {
          id: "4",
          text: "cool #mcp tool",
          author_id: "u4",
          created_at: "2026-01-04T00:00:00Z",
          conversation_id: "4",
          public_metrics: {},
          entities: {
            hashtags: [{ tag: "mcp" }, { tag: "ai" }],
          },
        },
      ],
    };
    const tweets = parseTweets(raw);
    expect(tweets[0].hashtags).toEqual(["mcp", "ai"]);
  });

  it("returns all tweets when data has multiple items", () => {
    const raw: RawResponse = {
      data: [
        { id: "10", text: "a", author_id: "u1", created_at: "", conversation_id: "10", public_metrics: {} },
        { id: "11", text: "b", author_id: "u1", created_at: "", conversation_id: "11", public_metrics: {} },
        { id: "12", text: "c", author_id: "u1", created_at: "", conversation_id: "12", public_metrics: {} },
      ],
    };
    const tweets = parseTweets(raw);
    expect(tweets).toHaveLength(3);
    expect(tweets.map((t) => t.id)).toEqual(["10", "11", "12"]);
  });
});
