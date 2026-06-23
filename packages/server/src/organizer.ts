/**
 * Organizer — auto-categorization, tagging, titling, linking, and scoping layer.
 *
 * Pure TypeScript heuristics + the ONNX embedding engine already wired into the server.
 * Zero external API calls.
 */

import type { Embeddings, VectorIndex, Store, MemoryType, MemoryScope } from './mcp/handler.js';

// ─── Pattern banks ──────────────────────────────────────────────────────────────

const TYPE_PATTERNS: Array<{ type: MemoryType; patterns: RegExp[] }> = [
  {
    type: 'decision',
    patterns: [
      /\b(decided|chose|chosen|picked|selected|went with|settled on)\b/i,
      /\b(the decision|we decided|decision was|choice is)\b/i,
      /\b(instead of|rather than going with)\b/i,
    ],
  },
  {
    type: 'procedure',
    patterns: [
      /\b(to do .+?,? first)\b/i,
      /\b(steps?:)/i,
      /\b(how to|howto)\b/i,
      /\b(run the following|execute|install .+ by)\b/i,
      /^\s*(1\.|step 1|\-\s)/m,
      /\b(workflow|recipe|guide|tutorial|walkthrough)\b/i,
    ],
  },
  {
    type: 'preference',
    patterns: [
      /\b(I prefer|we prefer|always use|never use|never do|always do)\b/i,
      /\b(I like to|I want to|my preference|preferred)\b/i,
      /\b(must always|must never|should always|should never)\b/i,
    ],
  },
  {
    type: 'reference',
    patterns: [
      /\b(see also|docs at|documentation at|link:|url:|ref:)\b/i,
      /https?:\/\/\S+/,
      /\b(wiki|confluence|readme|spec at)\b/i,
    ],
  },
  {
    type: 'context',
    patterns: [
      /\b(context:|background:|for context|note that|fyi|keep in mind)\b/i,
      /\b(currently|right now|as of today|at this point)\b/i,
    ],
  },
];

const NEGATION_WORDS = new Set([
  'not', 'no', 'never', "don't", "doesn't", "didn't", "won't", "can't",
  'cannot', 'instead', 'stop', 'avoid', 'removed', 'deprecated', 'disable',
  'without', 'neither', 'nor', "shouldn't", "wasn't", "aren't", "isn't",
]);

const SUPERSEDE_PATTERNS = [
  /\b(instead of|replaces?|replaced by|no longer|supersedes?|obsoletes?)\b/i,
  /\b(use .+ instead|switch(?:ed)? (?:to|from)|migrat(?:e|ed|ing) (?:to|from))\b/i,
  /\b(deprecated in favor|updated to use|moved to)\b/i,
];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'that', 'this',
  'it', 'its', 'what', 'which', 'who', 'whom', 'these', 'those', 'am',
  'about', 'up', 'down', 'also', 'get', 'got', 'been', 'he', 'she',
  'they', 'them', 'their', 'his', 'her', 'we', 'you', 'your', 'my',
  'me', 'our', 'us', 'i', 'him',
]);

// ─── Helper functions ───────────────────────────────────────────────────────────

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function isCamelCase(word: string): boolean {
  return /^[a-z]+[A-Z]/.test(word);
}

function isSnakeCase(word: string): boolean {
  return /^[a-z]+_[a-z]+/.test(word);
}

function isAllCaps(word: string): boolean {
  return /^[A-Z][A-Z_]{2,}$/.test(word);
}

function hasDotNotation(word: string): boolean {
  return /^[a-zA-Z]+\.[a-zA-Z]+/.test(word);
}

function isNamedEntity(word: string, idx: number, words: string[]): boolean {
  // Capitalized word not at sentence start
  if (!/^[A-Z][a-z]+/.test(word)) return false;
  if (idx === 0) return false;
  // Check previous token doesn't end a sentence
  const prev = words[idx - 1];
  if (prev && /[.!?]$/.test(prev)) return false;
  return true;
}

function extractSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function tokenize(text: string): string[] {
  return text.split(/[\s,;:()\[\]{}"'`]+/).filter(Boolean);
}

// ─── Organizer class ────────────────────────────────────────────────────────────

export interface OrganizeResult {
  title: string;
  type: string;
  tags: string[];
  scope: string;
  relations: Array<{ targetId: string; type: string }>;
}

export class Organizer {
  constructor(
    private embeddings: Embeddings,
    private vectorIndex: VectorIndex,
    private store: Store,
  ) {}

  /**
   * Auto-organize a piece of memory content.
   * Returns inferred title, type, tags, scope, and relations.
   * If existing values are provided, they take precedence over inferred values.
   */
  async organize(
    content: string,
    existingTitle?: string,
    existingType?: string,
    existingTags?: string[],
    existingScope?: string,
  ): Promise<OrganizeResult> {
    const type = existingType || this.inferType(content);
    const title = existingTitle || this.inferTitle(content);
    const tags = existingTags?.length ? existingTags : this.extractTags(content);
    const scope = existingScope || this.inferScope(content);
    const relations = await this.inferRelations(content);

    return { title, type, tags, scope, relations };
  }

  // ─── Type inference ─────────────────────────────────────────────────────────

  private inferType(content: string): MemoryType {
    // Score each type by how many patterns match
    let bestType: MemoryType = 'fact';
    let bestScore = 0;

    for (const { type, patterns } of TYPE_PATTERNS) {
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.test(content)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    return bestType;
  }

  // ─── Title inference ────────────────────────────────────────────────────────

  private inferTitle(content: string): string {
    const sentences = extractSentences(content.trim());
    if (!sentences.length) return content.slice(0, 60).trim();

    const first = sentences[0].trim();
    // If first sentence is short enough, use it directly
    if (first.length <= 80) {
      return first.replace(/[.!?]+$/, '');
    }

    // Extract most informative noun phrase from beginning
    const words = tokenize(first);
    // Take meaningful words up to ~60 chars
    let title = '';
    for (const word of words) {
      if (title.length + word.length + 1 > 60) break;
      title += (title ? ' ' : '') + word;
    }

    return title + '...';
  }

  // ─── Tag extraction ─────────────────────────────────────────────────────────

  private extractTags(content: string): string[] {
    const tags = new Set<string>();
    const words = tokenize(content);
    const rawWords = content.split(/[\s,;:()\[\]{}"'`]+/).filter(Boolean);

    // 1. Technical terms: camelCase, snake_case, ALL_CAPS, dot.notation
    for (const word of rawWords) {
      if (tags.size >= 5) break;
      const cleaned = word.replace(/[.,:;!?]+$/, '');
      if (isCamelCase(cleaned)) tags.add(cleaned);
      else if (isSnakeCase(cleaned)) tags.add(cleaned);
      else if (isAllCaps(cleaned) && cleaned.length > 2) tags.add(cleaned);
      else if (hasDotNotation(cleaned)) tags.add(cleaned);
    }

    // 2. Named entities (capitalized mid-sentence words)
    for (let i = 0; i < rawWords.length && tags.size < 5; i++) {
      const word = rawWords[i].replace(/[.,:;!?]+$/, '');
      if (isNamedEntity(word, i, rawWords) && !STOP_WORDS.has(word.toLowerCase())) {
        tags.add(word);
      }
    }

    // 3. Key nouns — words after determiners/adjectives that aren't stop words
    const determiners = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'your']);
    for (let i = 0; i < words.length - 1 && tags.size < 5; i++) {
      const lower = words[i].toLowerCase();
      if (determiners.has(lower)) {
        // Might be followed by adjective(s) then noun
        let nounIdx = i + 1;
        // Skip adjectives (simple heuristic: short lowercase words)
        while (
          nounIdx < words.length - 1 &&
          /^[a-z]+$/.test(words[nounIdx]) &&
          words[nounIdx].length < 8 &&
          !STOP_WORDS.has(words[nounIdx].toLowerCase())
        ) {
          nounIdx++;
        }
        if (nounIdx < words.length) {
          const noun = words[nounIdx].replace(/[.,:;!?]+$/, '').toLowerCase();
          if (noun.length > 2 && !STOP_WORDS.has(noun)) {
            tags.add(noun);
          }
        }
      }
    }

    // 4. Fallback: most frequent non-stop words
    if (tags.size < 3) {
      const freq = new Map<string, number>();
      for (const word of words) {
        const lower = word.toLowerCase().replace(/[.,:;!?]+$/, '');
        if (lower.length > 3 && !STOP_WORDS.has(lower)) {
          freq.set(lower, (freq.get(lower) || 0) + 1);
        }
      }
      const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
      for (const [word] of sorted) {
        if (tags.size >= 5) break;
        tags.add(word);
      }
    }

    return [...tags].slice(0, 5);
  }

  // ─── Scope inference ────────────────────────────────────────────────────────

  private inferScope(content: string): MemoryScope {
    const lower = content.toLowerCase();

    // Org-level signals
    if (/\b(company|organization|org-wide|everyone|all teams|enterprise)\b/.test(lower)) {
      return 'org';
    }

    // Team-level signals
    if (/\b(we|our team|the team|our group|team agreement|team decision)\b/.test(lower)) {
      return 'team';
    }

    // Personal signals (also the default)
    if (/\b(i |i'[a-z]+|my |me |myself)\b/.test(lower)) {
      return 'personal';
    }

    return 'personal';
  }

  // ─── Relation inference ─────────────────────────────────────────────────────

  private async inferRelations(content: string): Promise<Array<{ targetId: string; type: string }>> {
    const relations: Array<{ targetId: string; type: string }> = [];

    // Only attempt if the vector index has entries
    if (this.vectorIndex.size() === 0) return relations;

    // Embed the new content
    const embedding = await this.embeddings.embed(content);

    // Search for similar memories
    const candidates = this.vectorIndex.search(embedding, 10, 0.5);

    const contentLower = content.toLowerCase();
    const contentWords = new Set(tokenize(contentLower));
    const hasNegation = [...contentWords].some((w) => NEGATION_WORDS.has(w));
    const hasSupersede = SUPERSEDE_PATTERNS.some((p) => p.test(content));

    for (const candidate of candidates) {
      if (relations.length >= 5) break;

      const memory = await this.store.getMemory(candidate.id);
      if (!memory || memory.deleted) continue;

      // High similarity → relates_to
      if (candidate.score > 0.7) {
        // Check for supersedes signals
        if (hasSupersede) {
          // Verify the candidate is what's being superseded (content mentions similar topic)
          relations.push({ targetId: candidate.id, type: 'supersedes' });
        }
        // Check for contradiction (similar topic but negation)
        else if (hasNegation && candidate.score > 0.6 && candidate.score < 0.9) {
          // Only flag as contradicts if the existing memory doesn't also have negation
          const existingWords = new Set(tokenize(memory.content.toLowerCase()));
          const existingHasNegation = [...existingWords].some((w) => NEGATION_WORDS.has(w));
          if (!existingHasNegation) {
            relations.push({ targetId: candidate.id, type: 'contradicts' });
          } else {
            relations.push({ targetId: candidate.id, type: 'relates_to' });
          }
        } else {
          relations.push({ targetId: candidate.id, type: 'relates_to' });
        }
      }
      // Medium similarity with supersede language → supersedes
      else if (candidate.score > 0.6 && hasSupersede) {
        relations.push({ targetId: candidate.id, type: 'supersedes' });
      }
      // Medium similarity with negation → contradicts
      else if (candidate.score > 0.6 && hasNegation) {
        const existingWords = new Set(tokenize(memory.content.toLowerCase()));
        const existingHasNegation = [...existingWords].some((w) => NEGATION_WORDS.has(w));
        if (!existingHasNegation) {
          relations.push({ targetId: candidate.id, type: 'contradicts' });
        }
      }
    }

    return relations;
  }
}
