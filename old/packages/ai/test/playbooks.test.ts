import { describe, expect, it } from "vitest";
import { playbooks, playbookSources, withPlaybooks, type PlaybookId } from "../src/playbooks";

describe("playbooks", () => {
  it("keeps every playbook short enough to ride along in a system prompt", () => {
    for (const [id, text] of Object.entries(playbooks)) {
      expect(text.startsWith("## "), id).toBe(true);
      expect(text.length, id).toBeLessThan(3000);
    }
  });

  it("records the upstream skill of every playbook", () => {
    for (const id of Object.keys(playbooks) as PlaybookId[]) {
      expect(playbookSources[id].length, id).toBeGreaterThan(0);
    }
  });

  it("appends after the agent's rules, once per playbook", () => {
    const out = withPlaybooks("RULES", "copywriting", "imagery", "copywriting");
    expect(out.startsWith("RULES\n\n# Agency playbook")).toBe(true);
    expect(out.split(playbooks.copywriting).length).toBe(2);
    expect(out).toContain(playbooks.imagery);
    expect(withPlaybooks("RULES")).toBe("RULES");
  });
});
