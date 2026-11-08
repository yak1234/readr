import { test } from "node:test";
import assert from "node:assert/strict";
import { cueAt, parseJson3, wordsToCues } from "../shared/captions";

// Shape of YouTube's auto-caption json3: word segments with offsets, plus
// "\n" append events between lines.
const AUTO = {
  events: [
    { tStartMs: 0, dDurationMs: 9000 },
    { tStartMs: 2880, segs: [{ utf8: "600000" }, { utf8: " selon", tOffsetMs: 1040 }, { utf8: " la", tOffsetMs: 1320 }, { utf8: " police.", tOffsetMs: 1480 }, { utf8: " Ce", tOffsetMs: 2040 }] },
    { tStartMs: 6190, segs: [{ utf8: "\n" }] },
    { tStartMs: 6200, segs: [{ utf8: "jeudi," }, { utf8: " des", tOffsetMs: 120 }, { utf8: " milliers", tOffsetMs: 640 }, { utf8: " ont", tOffsetMs: 800 }, { utf8: " défilé.", tOffsetMs: 1040 }] },
  ],
};

test("parses word timings from auto captions", () => {
  const words = parseJson3(AUTO);
  assert.equal(words.length, 10);
  assert.deepEqual(words[1], { text: " selon", start: 3.92 });
  assert.equal(words[5].text, " jeudi,"); // a new line still starts a new word
});

test("groups words into timed sentences", () => {
  const cues = wordsToCues(parseJson3(AUTO));
  assert.deepEqual(cues.map((c) => c.text), ["600000 selon la police.", "Ce jeudi, des milliers ont défilé."]);
  assert.equal(cues[0].start, 2.88);
  assert.equal(cues[0].end, 4.92); // the next sentence's first word
  assert.equal(cues[1].start, 4.92);
  assert.ok(Math.abs(cues[1].end - (7.24 + 0.6)) < 1e-9); // last word plus a short tail
});

test("manual captions with one line per event keep a space between lines", () => {
  const words = parseJson3({ events: [{ tStartMs: 0, segs: [{ utf8: "Bonjour à tous" }] }, { tStartMs: 1500, segs: [{ utf8: "et bienvenue." }] }] });
  assert.deepEqual(wordsToCues(words).map((c) => c.text), ["Bonjour à tous et bienvenue."]);
});

test("splits run-on sentences at a comma", () => {
  const words = Array.from({ length: 40 }, (_, i) => ({ text: `${i ? " " : ""}mot${i}${i === 20 ? "," : ""}`, start: i * 0.3 }));
  const cues = wordsToCues(words);
  assert.equal(cues.length, 2);
  assert.ok(cues[0].text.endsWith("mot20,"));
});

test("finds the cue at a time", () => {
  const cues = [{ text: "a", start: 1, end: 2 }, { text: "b", start: 2, end: 3 }];
  assert.equal(cueAt(cues, 0.5), -1);
  assert.equal(cueAt(cues, 1.5), 0);
  assert.equal(cueAt(cues, 2), 1);
  assert.equal(cueAt(cues, 9), 1);
});
