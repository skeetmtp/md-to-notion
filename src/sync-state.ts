import fs from "fs"
import path from "path"
import crypto from "crypto"
import { LogLevel, makeConsoleLogger } from "./logging"

const logger = makeConsoleLogger("sync-state")

interface SyncState {
  fileHashes: Record<string, string>
}

export class SyncStateManager {
  private statePath: string
  private state: SyncState
  private pendingChanges: Set<string> = new Set()

  constructor(statePath: string) {
    this.statePath = statePath
    this.state = this.loadState()
  }

  private loadState(): SyncState {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = fs.readFileSync(this.statePath, "utf-8")
        return JSON.parse(data)
      }
    } catch (error) {
      logger(LogLevel.ERROR, "Error loading sync state", { error })
    }
    return { fileHashes: {} }
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.statePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch (error) {
      logger(LogLevel.ERROR, "Error saving sync state", { error })
    }
  }

  private calculateMD5(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex")
  }

  public hasFileChanged(filePath: string, content: string): boolean {
    const currentHash = this.calculateMD5(content)
    const previousHash = this.state.fileHashes[filePath]

    if (previousHash !== currentHash) {
      this.state.fileHashes[filePath] = currentHash
      this.pendingChanges.add(filePath)
      return true
    }

    return false
  }

  public removeFile(filePath: string): void {
    delete this.state.fileHashes[filePath]
    this.pendingChanges.add(filePath)
  }

  public saveFileState(filePath: string): void {
    if (this.pendingChanges.has(filePath)) {
      this.saveState()
      this.pendingChanges.delete(filePath)
    }
  }

  public savePendingChanges(): void {
    if (this.pendingChanges.size > 0) {
      this.saveState()
      this.pendingChanges.clear()
    }
  }
}
