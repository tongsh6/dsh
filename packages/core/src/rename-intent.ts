export interface RenameIntent {
  from?: string;
  to?: string;
  detected: boolean;
}

const FILE_PATH = String.raw`[A-Za-z0-9@_./-]+\.[A-Za-z0-9][A-Za-z0-9._-]*`;

function cleanPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/^[`'"]+|[`'",，。；;:：)）\]]+$/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

export function extractRenameIntent(text: string | null | undefined): RenameIntent | null {
  const source = text ?? "";
  const patterns = [
    new RegExp(String.raw`[` + "`" + String.raw`'"]?(${FILE_PATH})[` + "`" + String.raw`'"]?\s*(?:->|=>|→|↦|⟶)\s*[` + "`" + String.raw`'"]?(${FILE_PATH})`, "u"),
    new RegExp(String.raw`\b(?:rename|move|renaming|moving)\s+[` + "`" + String.raw`'"]?(${FILE_PATH})[` + "`" + String.raw`'"]?\s+(?:to|as|into)\s+[` + "`" + String.raw`'"]?(${FILE_PATH})`, "iu"),
    new RegExp(String.raw`\bfrom\s+[` + "`" + String.raw`'"]?(${FILE_PATH})[` + "`" + String.raw`'"]?\s+to\s+[` + "`" + String.raw`'"]?(${FILE_PATH})`, "iu"),
    new RegExp(String.raw`将\s*[` + "`" + String.raw`'"]?(${FILE_PATH})[` + "`" + String.raw`'"]?\s*(?:重命名为|改名为|移动到|迁移到)\s*[` + "`" + String.raw`'"]?(${FILE_PATH})`, "u"),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const from = cleanPath(match?.[1]);
    const to = cleanPath(match?.[2]);
    if (from && to && from !== to) return { detected: true, from, to };
  }

  const lowered = source.toLowerCase();
  if (/\b(rename|renamed|renaming|move|moved|moving)\b/.test(lowered)) {
    return { detected: true };
  }
  if (/(重命名|改名|移动到|迁移到)/u.test(source)) {
    return { detected: true };
  }
  return null;
}

export function detectRenameIntent(text: string | null | undefined): boolean {
  return extractRenameIntent(text)?.detected === true;
}

export function formatRenameIntentGuidance(text: string | null | undefined): string | null {
  const intent = extractRenameIntent(text);
  if (!intent) return null;

  const specific = intent.from && intent.to
    ? [
        `Source path from task: ${intent.from}`,
        `Destination path from task: ${intent.to}`,
        `For this rename/move, prefer exactly <RENAME from="${intent.from}" to="${intent.to}" /> as the first content change block when preserving file content.`,
      ]
    : [
        "The task text indicates a rename/move, but no exact source/destination pair was parsed. Infer the pair from the original task and existing paths before editing.",
      ];

  return [
    "RENAME / MOVE INTENT DETECTED FROM ORIGINAL TASK:",
    ...specific,
    "Do not use <CREATE> to copy the destination for a rename; it risks content drift and leaves the source file behind.",
    "After the rename, update every import/export/reference with precise <SEARCH_REPLACE> blocks.",
    "Do not use shell rm/cp/mv; exec_shell is read-only.",
  ].join("\n");
}
