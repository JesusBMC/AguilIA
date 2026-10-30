/**
 * Local {@link RuleValidator}.
 *
 * Runs every rule in {@link RULES} over the extracted data and flattens the
 * findings into a single list. A rule that throws is surfaced with context
 * (never silently dropped) so a buggy rule cannot hide a validation gap.
 */

import type { ExtractedData, Finding } from "../../domain/types.ts";
import type { RuleValidator } from "../interfaces.ts";
import { RULES, type RuleDefinition } from "../../rules/rule-definitions.ts";

export class LocalRuleValidator implements RuleValidator {
  private readonly rules: RuleDefinition[];

  constructor(rules: RuleDefinition[] = RULES) {
    this.rules = rules;
  }

  async validate(extracted: ExtractedData): Promise<Finding[]> {
    if (!extracted || typeof extracted !== "object") {
      throw new Error("LocalRuleValidator.validate: extracted data is required");
    }

    const findings: Finding[] = [];
    for (const rule of this.rules) {
      try {
        const produced = rule.evaluate(extracted);
        if (Array.isArray(produced)) {
          findings.push(...produced);
        }
      } catch (err) {
        throw new Error(
          `LocalRuleValidator: rule "${rule.id}" failed: ${(err as Error).message}`,
        );
      }
    }
    return findings;
  }
}
