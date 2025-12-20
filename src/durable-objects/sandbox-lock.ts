import { DurableObject } from "cloudflare:workers";

export class SandboxLock extends DurableObject<CloudflareBindings> {
  private isLocked = false;

  async acquire() {
    if (this.isLocked) {
      return false;
    }
    this.isLocked = true;
    return true;
  }

  async release() {
    this.isLocked = false;
  }
}
