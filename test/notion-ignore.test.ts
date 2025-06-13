import * as fs from "fs"
import * as path from "path"
import { describe, expect, jest } from "@jest/globals"
import {
  parseNotionIgnore,
  shouldIgnorePath,
  getIgnorePatterns,
} from "../src/notion-ignore"

jest.mock("fs")
const mockedFs = jest.mocked(fs)

describe("notion-ignore", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("parseNotionIgnore", () => {
    it("parses .notionignore file correctly", () => {
      const mockContent = `
# This is a comment
*.md
!important.md
docs/
node_modules/
      `.trim()

      mockedFs.readFileSync.mockReturnValue(mockContent)

      const patterns = parseNotionIgnore("path/to/.notionignore")
      expect(patterns).toEqual([
        "*.md",
        "!important.md",
        "docs/",
        "node_modules/",
      ])
    })

    it("returns empty array if file does not exist", () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error("File not found")
      })

      const patterns = parseNotionIgnore("path/to/.notionignore")
      expect(patterns).toEqual([])
    })
  })

  describe("shouldIgnorePath", () => {
    it("matches glob patterns correctly", () => {
      const patterns = ["*.md", "docs/*", "!important.md"]

      expect(shouldIgnorePath("./test.md", patterns)).toBe(true)
      expect(shouldIgnorePath("./docs/test.md", patterns)).toBe(true)
      expect(shouldIgnorePath("./important.md", patterns)).toBe(false)
      expect(shouldIgnorePath("./other.txt", patterns)).toBe(false)
    })

    it("handles directory patterns", () => {
      const patterns = ["docs/", "node_modules/"]

      expect(shouldIgnorePath("./docs/file.md", patterns)).toBe(true)
      expect(shouldIgnorePath("./node_modules/package/file.md", patterns)).toBe(true)
      expect(shouldIgnorePath("./src/file.md", patterns)).toBe(false)
    })

    it("handles negation patterns", () => {
      const patterns = ["*.md", "!important.md"]

      expect(shouldIgnorePath("./test.md", patterns)).toBe(true)
      expect(shouldIgnorePath("./important.md", patterns)).toBe(false)
    })
  })

  describe("getIgnorePatterns", () => {
    it("reads .notionignore from specified directory", () => {
      const mockContent = "*.md\ndocs/"
      mockedFs.readFileSync.mockReturnValue(mockContent)

      const patterns = getIgnorePatterns("/test/dir")
      expect(patterns).toEqual(["*.md", "docs/"])
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        path.join("/test/dir", ".notionignore"),
        "utf-8"
      )
    })
  })
})
