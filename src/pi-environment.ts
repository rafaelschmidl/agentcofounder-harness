import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MODEL } from "./provider.js";

const PASSTHROUGH = [
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "BERGET_API_KEY",
  "BERGET_API_URL",
  "BERGET_AUTH_URL",
  "BERGET_INFERENCE_URL",
] as const;

export async function createPiEnvironment(
  stageDirectory: string,
  extra: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> {
  const home = path.join(stageDirectory, "home");
  const piState = path.join(stageDirectory, "pi-state");
  const sessions = path.join(stageDirectory, "sessions");
  const xdgRoot = path.join(stageDirectory, "xdg");
  const directories = [
    home,
    piState,
    sessions,
    path.join(xdgRoot, "config"),
    path.join(xdgRoot, "cache"),
    path.join(xdgRoot, "data"),
    path.join(xdgRoot, "state"),
  ];
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(
    path.join(piState, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          berget: {
            modelOverrides: {
              [DEFAULT_MODEL]: { maxTokens: 4096 },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  const environment: NodeJS.ProcessEnv = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
    XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
    XDG_DATA_HOME: path.join(xdgRoot, "data"),
    XDG_STATE_HOME: path.join(xdgRoot, "state"),
    PI_CODING_AGENT_DIR: piState,
    PI_CODING_AGENT_SESSION_DIR: sessions,
    PI_OFFLINE: "1",
  };
  for (const name of PASSTHROUGH) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
