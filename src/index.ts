#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VELOG_ENDPOINT = process.env.VELOG_ENDPOINT ?? "https://v3.velog.io/graphql";
const VELOG_ACCESS_TOKEN = process.env.VELOG_ACCESS_TOKEN ?? "";

type GqlResponse<T> = { data?: T; errors?: { message: string }[] };

async function velogRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  requireAuth = false,
): Promise<T> {
  if (requireAuth && !VELOG_ACCESS_TOKEN) {
    throw new Error(
      "VELOG_ACCESS_TOKEN is not set. Add it to the MCP server env to use authenticated tools.",
    );
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (VELOG_ACCESS_TOKEN) {
    headers["Cookie"] = `access_token=${VELOG_ACCESS_TOKEN}`;
  }
  const res = await fetch(VELOG_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Velog HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Velog GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("Velog GraphQL: empty data");
  }
  return json.data;
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "velog-mcp", version: "0.1.0" });

server.tool(
  "velog_whoami",
  "Show the authenticated Velog user (requires VELOG_ACCESS_TOKEN). Use this to verify the token is valid.",
  {},
  async () => {
    const data = await velogRequest<{ currentUser: unknown }>(
      `query { currentUser { id username email profile { display_name short_bio thumbnail } } }`,
      {},
      true,
    );
    return jsonResult(data.currentUser);
  },
);

server.tool(
  "velog_list_posts",
  "List posts. Filter by username and/or tag. Use `cursor` (last seen post id) for pagination.",
  {
    username: z.string().optional().describe("Velog username (without @). Omit for global feed."),
    tag: z.string().optional(),
    cursor: z.string().optional().describe("Post id to paginate after."),
    limit: z.number().int().min(1).max(50).default(20),
    temp_only: z.boolean().optional().describe("Only the authenticated user's draft posts."),
  },
  async (args) => {
    const data = await velogRequest<{ posts: unknown[] }>(
      `query Posts($input: GetPostsInput!) {
         posts(input: $input) {
           id title url_slug short_description thumbnail
           released_at updated_at is_private is_temp likes comments_count
           tags
           user { username profile { display_name } }
         }
       }`,
      { input: args },
      Boolean(args.temp_only),
    );
    return jsonResult(data.posts);
  },
);

server.tool(
  "velog_get_post",
  "Fetch a single post. Provide either `id`, or both `username` and `url_slug`.",
  {
    id: z.string().optional(),
    username: z.string().optional(),
    url_slug: z.string().optional(),
  },
  async (args) => {
    if (!args.id && !(args.username && args.url_slug)) {
      throw new Error("Provide `id`, or both `username` and `url_slug`.");
    }
    const data = await velogRequest<{ post: unknown }>(
      `query Post($input: ReadPostInput!) {
         post(input: $input) {
           id title body url_slug short_description thumbnail
           released_at updated_at is_private is_temp is_markdown
           likes views comments_count tags
           user { username profile { display_name } }
           series { id name }
         }
       }`,
      { input: args },
    );
    return jsonResult(data.post);
  },
);

const writePostShape = {
  title: z.string().min(1),
  body: z.string().describe("Post body in Markdown."),
  tags: z.array(z.string()).default([]),
  is_private: z.boolean().default(false),
  is_temp: z.boolean().default(false).describe("Save as draft instead of publishing."),
  url_slug: z
    .string()
    .default("")
    .describe("Custom slug. Leave empty to derive from title."),
  thumbnail: z.string().url().optional(),
  series_id: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
};

server.tool(
  "velog_write_post",
  "Publish (or save as draft) a new Velog post. Requires VELOG_ACCESS_TOKEN.",
  writePostShape,
  async (args) => {
    const input = { ...args, is_markdown: true };
    const data = await velogRequest<{ writePost: { id: string; url_slug: string; user: { username: string } } }>(
      `mutation WritePost($input: WritePostInput!) {
         writePost(input: $input) { id url_slug is_temp is_private user { username } }
       }`,
      { input },
      true,
    );
    const p = data.writePost;
    const url = `https://velog.io/@${p.user.username}/${p.url_slug}`;
    return jsonResult({ ...p, url });
  },
);

server.tool(
  "velog_edit_post",
  "Edit an existing Velog post. Requires VELOG_ACCESS_TOKEN. All required fields must be re-sent (use velog_get_post first if needed).",
  { id: z.string(), ...writePostShape },
  async (args) => {
    const input = { ...args, is_markdown: true };
    const data = await velogRequest<{ editPost: { id: string; url_slug: string; user: { username: string } } }>(
      `mutation EditPost($input: EditPostInput!) {
         editPost(input: $input) { id url_slug is_temp is_private user { username } }
       }`,
      { input },
      true,
    );
    const p = data.editPost;
    const url = `https://velog.io/@${p.user.username}/${p.url_slug}`;
    return jsonResult({ ...p, url });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[velog-mcp] fatal:", err);
  process.exit(1);
});
