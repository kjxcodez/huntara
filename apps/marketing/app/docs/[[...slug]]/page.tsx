import React from "react"
import { notFound } from "next/navigation"
import { Metadata } from "next"
import { compileMDX } from "next-mdx-remote/rsc"
import remarkGfm from "remark-gfm"
import rehypeSlug from "rehype-slug"
import rehypePrettyCode from "rehype-pretty-code"
import { getDocsNavigation, getDocBySlug, NavGroup } from "../../../lib/mdx-utils"
import { DocsLayoutShell } from "../../../components/DocsLayoutShell"
import { Callout, Note, Warning, Tip, Tabs, Tab, Steps, Step, Badge, VersionBadge, CardGrid, Card, TerminalWindow } from "../../../components/DocsComponents"
import { Mermaid } from "../../../components/Mermaid"
import { Pre } from "../../../components/Pre"

interface PageProps {
  params: Promise<{
    slug?: string[]
  }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedParams = await params
  const slug = resolvedParams.slug || []
  const doc = getDocBySlug(slug)
  if (!doc) {
    return {
      title: "Not Found",
      description: "Document not found"
    }
  }
  return {
    title: doc.frontmatter.title,
    description: doc.frontmatter.description || `Documentation for ${doc.frontmatter.title} in HUNTARA.`,
    openGraph: {
      title: `${doc.frontmatter.title} | HUNTARA Docs`,
      description: doc.frontmatter.description
    }
  }
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function preprocessMermaid(content: string) {
  return content.replace(/```mermaid\r?\n([\s\S]*?)\r?\n```/g, (match, chartCode) => {
    const base64Chart = Buffer.from(chartCode).toString("base64")
    return `<Mermaid chart="${base64Chart}" isbase64="true" />`
  })
}


function extractHeadings(content: string) {
  const headings: Array<{ level: number; text: string; id: string }> = []
  const lines = content.split('\n')
  let inCodeBlock = false

  for (let line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    if (line.startsWith('#')) {
      const match = line.match(/^(#{2,3})\s+(.*)$/)
      if (match) {
        const level = match[1].length
        const text = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1').trim()
        const id = slugify(text)
        headings.push({ level, text, id })
      }
    }
  }
  return headings
}

export default async function Page({ params }: PageProps) {
  const resolvedParams = await params
  const slug = resolvedParams.slug || []

  // Resolve MDX file by slug
  const doc = getDocBySlug(slug)
  if (!doc) {
    notFound()
  }

  const preprocessedSource = preprocessMermaid(doc.content)

  // Compile MDX on the server
  const { content } = await compileMDX({
    source: preprocessedSource,
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [
            rehypePrettyCode,
            {
              theme: "github-dark",
              keepBackground: true,
              onVisitLine(node: any) {
                if (node.children.length === 0) {
                  node.children = [{ type: "text", value: " " }]
                }
              }
            }
          ]
        ]
      }
    },
    components: {
      Callout,
      Note,
      Warning,
      Tip,
      Tabs,
      Tab,
      Steps,
      Step,
      Badge,
      VersionBadge,
      CardGrid,
      Card,
      Terminal: TerminalWindow,
      Mermaid,
      pre: Pre
    }
  })


  // Get dynamic navigation sidebar
  const navigation = getDocsNavigation()
  
  // Find current position in navigation to compute prev/next buttons
  const flatItems = navigation.flatMap(g => g.items)
  const currentSlugStr = slug.length === 0 ? "getting-started/installation" : slug.join("/")
  const currentIndex = flatItems.findIndex(item => item.id === currentSlugStr)
  
  const prevArticle = currentIndex > 0 ? flatItems[currentIndex - 1] : null
  const nextArticle = currentIndex < flatItems.length - 1 ? flatItems[currentIndex + 1] : null

  // Calculate reading time
  const wordCount = doc.content.split(/\s+/).length
  const readingTime = Math.max(1, Math.ceil(wordCount / 200))

  // Extract outline headings for TOC
  const headings = extractHeadings(doc.content)

  // Construct source edit path filename
  const editSlug = slug.length === 0 
    ? 'getting-started/installation.mdx' 
    : slug.join('/') + '.mdx'

  return (
    <DocsLayoutShell
      navigation={navigation}
      headings={headings}
      activeArticleId={currentSlugStr}
      activeTitle={doc.frontmatter.title}
      activeCategory={doc.frontmatter.category || "Docs"}
      activeDescription={doc.frontmatter.description}
      readingTime={readingTime}
      prevArticle={prevArticle}
      nextArticle={nextArticle}
      slugStr={editSlug}
    >
      {content}
    </DocsLayoutShell>
  )
}
