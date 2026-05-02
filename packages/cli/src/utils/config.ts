import { loadDshConfig, readApiKey } from "@dsh/repo";
import { DeepSeekClient } from "@dsh/provider";

export const readConfig = loadDshConfig;

export function createClient(cwd: string): DeepSeekClient {
  const apiKey = process.env["DEEPSEEK_API_KEY"] ?? readApiKey(cwd) ?? "";
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY not set. Set it as environment variable or in .dsh/config.yml deepseek.api_key",
    );
  }
  return new DeepSeekClient({ apiKey });
}
