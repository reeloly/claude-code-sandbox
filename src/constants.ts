export const USER_DIR = "users";
export const PROJECT_DIR = "projects";
export const DEV_DIR = "dev";
export const PROD_DIR = "prod";

export const BUNDLE_FILE_KEY = "repo.bundle";
export const TEMPLATE_BUNDLE_FILE_KEY = `initialization/${BUNDLE_FILE_KEY}`;

export const INIT_SCRIPT_PATH = "./scripts/init.sh";

export function getProjectR2Path(
  userId: string,
  projectId: string,
  mode: "dev" | "prod"
) {
  return `${
    mode === "dev" ? DEV_DIR : PROD_DIR
  }/${USER_DIR}/${userId}/${PROJECT_DIR}/${projectId}`;
}
