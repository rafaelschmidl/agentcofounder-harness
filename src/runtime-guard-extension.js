import { createBashTool } from "@earendil-works/pi-coding-agent";

const CONTROL_VARIABLE_PATTERN = /^(?:CHALLENGE_|QUALIFICATION_|BERGET_|AGENTCOFOUNDER_TEST_|AGENTCOFOUNDER_ISOLATION_ROOT$)/u;
const CREDENTIAL_VARIABLE_PATTERN = /(?:^|_)(?:API_KEY|AUTHORIZATION|PASSWORD|SECRET|CREDENTIAL|BEARER|ACCESS_TOKEN|REFRESH_TOKEN|ID_TOKEN)$/iu;

/** Strip runtime controls and provider-neutral credential names from bash. */
export function guardBashEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) =>
      !CONTROL_VARIABLE_PATTERN.test(name) && !CREDENTIAL_VARIABLE_PATTERN.test(name),
    ),
  );
}

export default function runtimeGuardExtension(pi) {
  const bashTool = createBashTool(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => ({
      command,
      cwd,
      env: guardBashEnvironment(env),
    }),
  });
  pi.registerTool(bashTool);
}
