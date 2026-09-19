import type { MetadataRoute } from "next"
import { getAllReleases } from "../lib/generated-releases"

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://huntara.app"
  const releases = getAllReleases()

  // Base static routes
  const routes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/download`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/releases`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/features`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/security`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ]

  // Add releases and valid platform landing pages only
  for (const rel of releases) {
    routes.push({
      url: `${baseUrl}/releases/${rel.version}`,
      lastModified: new Date(rel.releasedAt),
      changeFrequency: "monthly",
      priority: 0.8,
    })

    for (const plat of rel.platforms) {
      routes.push({
        url: `${baseUrl}/releases/${rel.version}/${plat.id}`,
        lastModified: new Date(rel.releasedAt),
        changeFrequency: "monthly",
        priority: 0.7,
      })
    }
  }

  return routes
}
