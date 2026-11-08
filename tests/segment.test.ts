import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences, tokenize } from "../shared/segment";

test("splits ordinary French sentences", () => {
  const s = splitSentences("Le gouvernement a annoncé un plan. Les syndicats sont sceptiques ! Que va-t-il se passer ?");
  assert.deepEqual(s, ["Le gouvernement a annoncé un plan.", "Les syndicats sont sceptiques !", "Que va-t-il se passer ?"]);
});

test("does not split after titles and initials", () => {
  const s = splitSentences("M. Macron a reçu Mme Dupont à l'Élysée. Selon J. K. Rowling, rien ne change.");
  assert.deepEqual(s, ["M. Macron a reçu Mme Dupont à l'Élysée.", "Selon J. K. Rowling, rien ne change."]);
});

test("keeps closing guillemets with their sentence", () => {
  const s = splitSentences("« C'est inacceptable », a-t-il déclaré. Le débat continue.");
  assert.equal(s.length, 2);
  assert.ok(s[0].startsWith("« C'est inacceptable »"));
});

test("tokenize separates elisions so each word is clickable", () => {
  const words = tokenize("L'économie s'est redressée aujourd'hui, jusqu'à présent.").filter((t) => t.isWord).map((t) => t.text);
  assert.deepEqual(words, ["L'", "économie", "s'", "est", "redressée", "aujourd'hui", "jusqu'", "à", "présent"]);
});

test("tokenize keeps hyphenated words and treats numbers as non-words", () => {
  const toks = tokenize("Va-t-il payer 3,5 milliards ?");
  assert.deepEqual(toks.filter((t) => t.isWord).map((t) => t.text), ["Va-t-il", "payer", "milliards"]);
  assert.equal(toks.map((t) => t.text).join(""), "Va-t-il payer 3,5 milliards ?");
});
