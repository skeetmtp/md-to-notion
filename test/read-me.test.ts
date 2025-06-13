import { readMarkdownFiles } from "../src/read-md"
import * as fs from "fs"
import { describe, expect, jest } from "@jest/globals"

jest.mock("fs")
const mockedFs = jest.mocked(fs)

describe("readMarkdownFiles", () => {
  const mockDirPath = "mockDir"

  const defaultDirent = {
    parentPath: "",
    path: "",
    isSocket: () => false,
    isBlockDevice: () => true,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
  }

  function mockFile(_baseName: string, fileName: string, content: string) {
    mockedFs.readdirSync.mockReturnValue([
      {
        name: fileName,
        isDirectory: () => false,
        isFile: () => true,
        ...defaultDirent,
      } as any,
      {
        name: "subdirectory",
        isDirectory: () => true,
        isFile: () => false,
        ...defaultDirent,
      } as any,
    ])
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    mockedFs.statSync.mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
    })

    mockedFs.readFileSync.mockReturnValue(content)
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns null for an empty directory", () => {
    mockedFs.readdirSync.mockReturnValue([])
    const result = readMarkdownFiles(mockDirPath)
    expect(result).toBeNull()
  })

  it("reads markdown files and returns folder structure", () => {
    mockFile("file1", "file1.md", "content")

    const result = readMarkdownFiles(mockDirPath)
    expect(result).toEqual({
      name: ".",
      files: [
        expect.objectContaining({
          fileName: "file1",
          getContent: expect.any(Function),
        }),
      ],
      subfolders: [],
    })
  })

  it("replace links even if root contains .. path", () => {
    mockFile("file1", "file1.md", "test [link](./section)")

    const result = readMarkdownFiles("../test/path")
    const content = result?.files[0]?.getContent(
      new Map([["./section", "https://example.com/src/test"]])
    )
    expect(content).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              annotations: {
                bold: false,
                strikethrough: false,
                underline: false,
                italic: false,
                code: false,
                color: "default",
              },
              text: {
                content: "test ",
              },
            },
            {
              type: "text",
              annotations: {
                bold: false,
                strikethrough: false,
                underline: false,
                italic: false,
                code: false,
                color: "default",
              },
              text: {
                content: "link",
                link: {
                  type: "url",
                  url: "https://example.com/src/test",
                },
              },
            },
          ],
        },
      },
    ])
    expect(result).toEqual({
      name: ".",
      files: [
        expect.objectContaining({
          fileName: "file1",
          getContent: expect.any(Function),
        }),
      ],
      subfolders: [],
    })
  })

  it("reads more than 3 depth of nested bullet-list", () => {
    mockFile(
      "file1",
      "file1.md",
      "* depth1\n  * depth2\n    * depth3\n      * depth4"
    )

    const result = readMarkdownFiles(mockDirPath)
    const content = result?.files[0]?.getContent(new Map())
    expect(content).toEqual([
      {
        bulleted_list_item: {
          children: [
            {
              bulleted_list_item: {
                children: [
                  {
                    bulleted_list_item: {
                      children: [
                        {
                          bulleted_list_item: {
                            rich_text: [
                              {
                                annotations: {
                                  bold: false,
                                  code: false,
                                  color: "default",
                                  italic: false,
                                  strikethrough: false,
                                  underline: false,
                                },
                                text: {
                                  content: "depth4",
                                },
                                type: "text",
                              },
                            ],
                          },
                          object: "block",
                          type: "bulleted_list_item",
                        },
                      ],
                      rich_text: [
                        {
                          annotations: {
                            bold: false,
                            code: false,
                            color: "default",
                            italic: false,
                            strikethrough: false,
                            underline: false,
                          },
                          text: {
                            content: "depth3",
                          },
                          type: "text",
                        },
                      ],
                    },
                    object: "block",
                    type: "bulleted_list_item",
                  },
                ],
                rich_text: [
                  {
                    annotations: {
                      bold: false,
                      code: false,
                      color: "default",
                      italic: false,
                      strikethrough: false,
                      underline: false,
                    },
                    text: {
                      content: "depth2",
                    },
                    type: "text",
                  },
                ],
              },
              object: "block",
              type: "bulleted_list_item",
            },
          ],
          rich_text: [
            {
              annotations: {
                bold: false,
                code: false,
                color: "default",
                italic: false,
                strikethrough: false,
                underline: false,
              },
              text: {
                content: "depth1",
              },
              type: "text",
            },
          ],
        },
        object: "block",
        type: "bulleted_list_item",
      },
    ])
  })
})
