// Tests for reuse, which lets status answers close together share one round of system checks.
import { expect, test } from "bun:test";
import { reuse } from "./reuse.ts";

// A check that counts its runs and answers with the run number.
const counter = () => {
  let runs = 0;
  return { check: async () => ++runs, runs: () => runs };
};

test("answers within the window share one check, later ones run a new one", async () => {
  const { check, runs } = counter();
  const cached = reuse(check, 50);
  expect(await Promise.all([cached(), cached(), cached()])).toEqual([1, 1, 1]); // three pages asking at once
  expect(await cached()).toBe(1);
  await Bun.sleep(60);
  expect(await cached()).toBe(2);
  expect(runs()).toBe(2);
});

test("after a reset the next answer runs a new check", async () => {
  const { check } = counter();
  const cached = reuse(check, 60_000);
  expect(await cached()).toBe(1);
  cached.reset(); // the server's own run ended: the next status must see it
  expect(await cached()).toBe(2);
  expect(await cached()).toBe(2);
});

test("a failed check isn't reused", async () => {
  let runs = 0;
  const cached = reuse(async () => { if (++runs === 1) throw new Error("pgrep missing"); return runs; }, 60_000);
  await expect(cached()).rejects.toThrow("pgrep missing");
  expect(await cached()).toBe(2);
});
