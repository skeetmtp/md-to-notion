import { SyncStateManager } from "../src/sync-state"
import fs from "fs"
import path from "path"
import os from "os"

// Mock fs module
jest.mock("fs")
const mockedFs = fs as jest.Mocked<typeof fs>

describe("SyncStateManager", () => {
    let tempDir: string
    let stateFile: string

    beforeEach(() => {
        // Create a temporary directory path for testing
        tempDir = path.join(os.tmpdir(), "md-to-notion-test", Date.now().toString())
        stateFile = path.join(tempDir, "sync-state.json")

        // Reset all mocks
        jest.clearAllMocks()
    })

    afterEach(() => {
        // Reset mocks
        jest.resetAllMocks()
    })

    describe("constructor behavior", () => {
        it("should initialize with empty state and not load from file automatically", () => {
            // Mock fs.existsSync to return true to simulate existing state file
            mockedFs.existsSync.mockReturnValue(true)
            mockedFs.readFileSync.mockReturnValue(JSON.stringify({
                fileHashes: {
                    "existing-file.md": "abc123",
                    "another-file.md": "def456"
                }
            }))

            const manager = new SyncStateManager(stateFile)

            // Verify that the constructor does NOT automatically load state
            expect(mockedFs.existsSync).not.toHaveBeenCalled()
            expect(mockedFs.readFileSync).not.toHaveBeenCalled()

            // Verify that state is initialized as empty
            const hasChanged = manager.hasFileChanged("existing-file.md", "new content")
            expect(hasChanged).toBe(true) // Should be true because no previous state was loaded
        })

        it("should allow manual loading of state after construction", () => {
            const existingState = {
                fileHashes: {
                    "existing-file.md": "abc123",
                    "another-file.md": "def456"
                }
            }

            mockedFs.existsSync.mockReturnValue(true)
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState))

            const manager = new SyncStateManager(stateFile)

            // Manually load state
            manager.loadState()

            // Verify that fs methods were called during manual loading
            expect(mockedFs.existsSync).toHaveBeenCalledWith(stateFile)
            expect(mockedFs.readFileSync).toHaveBeenCalledWith(stateFile, "utf-8")
        })
    })

    describe("loadState", () => {
        it("should load existing state from file", () => {
            const existingState = {
                fileHashes: {
                    "file1.md": "hash1",
                    "file2.md": "hash2"
                }
            }

            mockedFs.existsSync.mockReturnValue(true)
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState))

            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            expect(mockedFs.existsSync).toHaveBeenCalledWith(stateFile)
            expect(mockedFs.readFileSync).toHaveBeenCalledWith(stateFile, "utf-8")

            expect(manager.hasFileChanged("file1.md", "content", () => "hash1")).toEqual(false)
            expect(manager.hasFileChanged("file2.md", "content", () => "hash2")).toEqual(false)
        })

        it("should return empty state when file doesn't exist", () => {
            mockedFs.existsSync.mockReturnValue(false)

            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            expect(mockedFs.existsSync).toHaveBeenCalledWith(stateFile)
            expect(mockedFs.readFileSync).not.toHaveBeenCalled()

            // Test that it uses empty state
            const hasChanged = manager.hasFileChanged("test.md", "content")
            expect(hasChanged).toBe(true)
        })
    })

    describe("hasFileChanged", () => {
        it("should return true for new files", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            const hasChanged = manager.hasFileChanged("new-file.md", "content")
            expect(hasChanged).toBe(true)
        })

        it("should return false for unchanged files", () => {
            const content = "# Test content"
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            // First check - should return true (new file)
            const firstCheck = manager.hasFileChanged("test.md", content)
            expect(firstCheck).toBe(true)

            // Second check with same content - should return false
            const secondCheck = manager.hasFileChanged("test.md", content)
            expect(secondCheck).toBe(false)
        })

        it("should return true for changed files", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            // First content
            manager.hasFileChanged("test.md", "original content")

            // Changed content
            const hasChanged = manager.hasFileChanged("test.md", "modified content")
            expect(hasChanged).toBe(true)
        })

        it("should update hash and add to pending changes when file changes", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            manager.hasFileChanged("test.md", "content")

            // File should now be in pending changes
            mockedFs.writeFileSync.mockImplementation(() => undefined)
            mockedFs.existsSync.mockReturnValue(false)
            mockedFs.mkdirSync.mockImplementation(() => undefined)

            manager.saveFileState("test.md")
            expect(mockedFs.writeFileSync).toHaveBeenCalled()
        })
    })

    describe("removeFile", () => {
        it("should remove file hash from state", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            // Add a file first
            manager.hasFileChanged("test.md", "content")

            // Remove the file
            manager.removeFile("test.md")

            // File should now be treated as new again
            const hasChanged = manager.hasFileChanged("test.md", "content")
            expect(hasChanged).toBe(true)
        })

        it("should add file to pending changes", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            manager.removeFile("test.md")

            // Should trigger save when saveFileState is called
            mockedFs.writeFileSync.mockImplementation(() => undefined)
            mockedFs.existsSync.mockReturnValue(false)
            mockedFs.mkdirSync.mockImplementation(() => undefined)

            manager.saveFileState("test.md")
            expect(mockedFs.writeFileSync).toHaveBeenCalled()
        })

        it("should handle removing non-existent files gracefully", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            // Should not throw error
            expect(() => {
                manager.removeFile("non-existent.md")
            }).not.toThrow()
        })
    })

    describe("saveFileState", () => {
        beforeEach(() => {
            mockedFs.writeFileSync.mockImplementation(() => undefined)
            mockedFs.existsSync.mockReturnValue(false)
            mockedFs.mkdirSync.mockImplementation(() => undefined)
        })

        it("should save state when file has pending changes", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            // Make a change to create pending change
            manager.hasFileChanged("test.md", "content")

            manager.saveFileState("test.md")

            expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
                stateFile,
                expect.stringContaining('"fileHashes"')
            )
        })

        it("should not save state when file has no pending changes", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            manager.saveFileState("test.md")

            expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
        })

        it("should remove file from pending changes after saving", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            manager.hasFileChanged("test.md", "content")
            manager.saveFileState("test.md")

            // Second call should not trigger save
            jest.clearAllMocks()
            manager.saveFileState("test.md")
            expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
        })

        it("should create directory if it doesn't exist", () => {
            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            manager.hasFileChanged("test.md", "content")
            manager.saveFileState("test.md")

            expect(mockedFs.mkdirSync).toHaveBeenCalledWith(tempDir, { recursive: true })
        })
    })

    describe("integration tests", () => {
        beforeEach(() => {
            mockedFs.writeFileSync.mockImplementation(() => undefined)
            mockedFs.existsSync.mockReturnValue(false)
            mockedFs.mkdirSync.mockImplementation(() => undefined)
        })

        it("should handle complete workflow: load, check, modify, save", () => {
            // Setup existing state
            const existingState = {
                fileHashes: {
                    "existing.md": "oldhash"
                }
            }

            mockedFs.existsSync.mockReturnValueOnce(true)
            mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState))

            const manager = new SyncStateManager(stateFile)
            manager.loadState()

            // Check existing file with same content
            const unchangedCheck = manager.hasFileChanged("existing.md", "old content")
            expect(unchangedCheck).toBe(true) // Hash will be different due to actual content

            // Check new file
            const newFileCheck = manager.hasFileChanged("new.md", "new content")
            expect(newFileCheck).toBe(true)

            // Save all changes
            manager.savePendingChanges()

            expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
                stateFile,
                expect.stringContaining('"existing.md"')
            )
        })

    })
})
