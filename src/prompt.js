export function buildChallengePrompt(idea) {
  return [
    "Build one complete, locally runnable web application in the current working directory.",
    "The evaluator will judge the resulting files and behavior independently; do not claim features that are not implemented.",
    "Work only inside the current directory and do not inspect credentials or runtime control variables.",
    "Use a self-contained Node.js project with package.json and a committed npm lockfile.",
    "Provide non-interactive `npm test`, `npm run build`, and `npm run dev -- --host 127.0.0.1 --port 3000` workflows.",
    "Do not require external services, accounts, API keys, or network access after dependencies are installed.",
    "Implement every explicit requirement in the product brief, including durable browser-local persistence when the brief requires persistence.",
    "",
    "PRODUCT BRIEF",
    "-------------",
    idea.trim(),
  ].join("\n");
}
