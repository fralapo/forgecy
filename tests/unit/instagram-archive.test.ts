import test from "node:test";
import assert from "node:assert/strict";
import { countInstagramArchiveFollowers } from "../../lib/instagram-archive";

test("counts unique usernames across numbered Instagram follower files", () => {
  assert.equal(countInstagramArchiveFollowers([
    { name: "followers_1.json", text: JSON.stringify([
      { string_list_data: [{ value: "Alice", href: "https://instagram.com/alice" }] },
      { string_list_data: [{ value: "bob" }] },
    ]) },
    { name: "followers_2.json", text: JSON.stringify([
      { string_list_data: [{ href: "https://www.instagram.com/_u/BOB" }] },
      { title: "carol" },
    ]) },
  ]), 3);
});

test("accepts wrapped follower arrays and refuses ambiguous or incomplete exports", () => {
  assert.equal(countInstagramArchiveFollowers([{ name: "followers.json", text: JSON.stringify({
    relationships_followers: [{ string_list_data: [{ value: "dave" }] }],
  }) }]), 1);
  assert.throws(() => countInstagramArchiveFollowers([{ name: "following.json", text: "[]" }]), /solo file followers/i);
  assert.throws(() => countInstagramArchiveFollowers([{ name: "followers_1.json", text: "not json" }]), /JSON valido/i);
  assert.throws(() => countInstagramArchiveFollowers([{ name: "followers_1.json", text: "[{}]" }]), /incompleto/i);
});
