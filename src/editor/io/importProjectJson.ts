import type { DirectorProject } from "../schema/directorProject";
import { validateDirectorProject } from "./projectValidation";

export function parseProject(json: string): DirectorProject {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("工程 JSON 格式错误");
  }
  return validateDirectorProject(value);
}
