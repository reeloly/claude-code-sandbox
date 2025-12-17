interface CmdOutput {
  success: boolean;
  stdout: string;
  stderr: string;
}

// helper to read the outputs from `.exec` results
export const getOutput = (res: CmdOutput) =>
  res.success ? res.stdout : res.stderr;
