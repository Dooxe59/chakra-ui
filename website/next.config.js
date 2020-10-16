const withPlugins = require("next-compose-plugins")
const withMdx = require("next-mdx-enhanced")
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
})
const path = require("path")
const execa = require("execa")
const fromUnixTime = require("date-fns/fromUnixTime")
const format = require("date-fns/format")
const { getEditUrl, addLeadingSlash } = require("@docusaurus/utils")
const { Octokit } = require("@octokit/rest")

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

async function getUserData(username) {
  try {
    const { data } = await octokit.users.getByUsername({ username })

    const {
      avatar_url: avatarUrl,
      html_url: githubUrl,
      blog: websiteUrl,
      bio,
      name,
      twitter_username: twitterUsername,
    } = data

    return {
      login: username,
      avatarUrl,
      githubUrl,
      websiteUrl,
      bio,
      name,
      twitterUsername,
    }
  } catch {
    // given a user no longer exists, octokit will error
  }
}

const EDIT_URL =
  "https://github.com/chakra-ui/chakra-ui/edit/develop/website/pages"

/**
 * Gets the last edited timestamp and author from git
 * using `git log`
 *
 * %an = author name
 * %ct = committer date, UNIX timestamp
 *
 * @see https://git-scm.com/docs/git-log
 */
async function getLastEdited(filePath) {
  try {
    const { stdout } = await execa("git", [
      "log",
      "-1",
      "--format=%ct, %an",
      "--follow",
      "--",
      filePath,
    ])
    return getTimestampAndAuthor(stdout)
  } catch (error) {
    // console.error(error)
  }
}

const GIT_COMMIT_TIMESTAMP_AUTHOR_REGEX = /^(\d+), (.+)$/

/**
 * Format the last edited timestamp and author from git output
 */
function getTimestampAndAuthor(str) {
  if (!str) return null

  const temp = str.match(GIT_COMMIT_TIMESTAMP_AUTHOR_REGEX)

  if (!temp || temp.length < 3) return null

  const [_, timestamp, author] = temp
  const dateStr = fromUnixTime(+timestamp)

  return {
    date: format(dateStr, "MMMM dd, yyyy"),
    author,
  }
}

function fileToPath(str) {
  return addLeadingSlash(str.replace(".mdx", ""))
}

const defaultConfig = {
  target: "serverless",
  webpack: (config, options) => {
    withPreact(config, options)

    return {
      ...config,
      externals: [...config.externals, "sharp"],
    }
  },
  experimental: {
    optimizeFonts: true,
    optimizeImages: true,
    modern: true,
  },
  redirects: require("./next-redirect"),
}

/**
 * replaces React with Preact in prod
 * this reduces the bundle size by approx. 32 kB
 */
const withPreact = (config, options) => {
  if (!options.dev) {
    const splitChunks = config.optimization && config.optimization.splitChunks

    if (splitChunks) {
      const cacheGroups = splitChunks.cacheGroups
      const test = /[\\/]node_modules[\\/](preact|preact-render-to-string|preact-context-provider)[\\/]/
      if (cacheGroups.framework) {
        cacheGroups.preact = {
          ...cacheGroups.framework,
          test,
        }

        cacheGroups.commons.name = "framework"
      } else {
        cacheGroups.preact = {
          name: "commons",
          chunks: "all",
          test,
        }
      }
    }

    const aliases = config.resolve.alias || (config.resolve.alias = {})
    aliases.react = aliases["react-dom"] = "preact/compat"
    aliases["react-ssr-prepass"] = "preact-ssr-prepass"
  }
}

const mdxConfig = {
  layoutPath: "layouts",
  defaultLayout: true,
  fileExtensions: ["mdx"],
  remarkPlugins: [
    require("remark-autolink-headings"),
    require("remark-emoji"),
    require("remark-images"),
    require("remark-slug"),
    require("remark-toc"),
    require("remark-unwrap-images"),
  ],
  rehypePlugins: [],
  extendFrontMatter: {
    process: async (_, frontmatter) => {
      const { __resourcePath: mdxPath, author, tags } = frontmatter

      // read the file path
      const filePath = path.join(process.cwd(), "pages", mdxPath)

      // get the last edited author and date
      const lastEdited = await getLastEdited(filePath)

      // get the edit url
      const editUrl = getEditUrl(mdxPath, EDIT_URL)

      // get the slug
      const slug = fileToPath(mdxPath)

      // if frontmatter inclues author, add the author's data
      const authorData = author ? await getUserData(author) : undefined

      return {
        slug,
        lastEdited,
        editUrl,
        author: authorData,
        tags,
      }
    },
  },
}

module.exports = withPlugins(
  [withBundleAnalyzer, withMdx(mdxConfig)],
  defaultConfig,
)
