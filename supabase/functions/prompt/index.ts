// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import * as dotenv from "https://deno.land/x/dotenv/mod.ts";
dotenv.config();

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

console.log("Hello from Functions!");

import OpenAI from "https://deno.land/x/openai@v4.20.1/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import fm from "npm:front-matter@4.0.2";
// Instantiate the OpenAI client with the API key
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

// Retrieve docs
export const parseExpoDocs = async (slug: string) => {
  const url = `https://raw.githubusercontent.com/expo/expo/main/docs/pages/${slug}.mdx`;
  const response = await fetch(url);
  const content = await response.text();
  const data = fm(content);

  //console.log(`Parsed front matter for ${slug}:`, data.attributes); // Debug log for parsed front matter
  return data;
};

export const generateEmbedding = async (input: string) => {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input,
    encoding_format: "float",
  });

  const vector = embedding.data[0].embedding;
  return vector;
};

export const completion = async (prompt: string) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0];
};

const buildFullPrompt = (query: string, docsContext: string) => {
  const prompt_boilerplate =
    "Answer the question posted in user query section using the provided context";
  const user_query_boilerplate = "USER QUERY: ";
  const document_context_boilerplate = "CONTEXT: ";
  const final_answer_boilerplate = "Final Answer: ";

  const filled_prompt_template = `
  ${prompt_boilerplate}
  ${user_query_boilerplate} ${query}
  ${document_context_boilerplate} ${docsContext} 
  ${final_answer_boilerplate}
  `;
  return filled_prompt_template;
};

Deno.serve(async (req) => {
  
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  );

  const { query } = await req.json();

  // Generate Embedding for user query
  const vector = await generateEmbedding(query);

  // Find similar/relevant docs to user query
  const { data: similarDocs, error } = await supabase.rpc("match_documents", {
    query_embedding: vector,
    match_threshold: 0.3,
    match_count: 2,
  });

  // Merge docs into one single string
  const docs = await Promise.all(
    similarDocs.map((doc: any) => parseExpoDocs(doc.id)),
  );
  const docsBoddies = docs.map((doc) => doc.body);
  const contents = "".concat(...docsBoddies);

  const filledPrompt = buildFullPrompt(query, contents);

  const answer = await completion(filledPrompt);

  const data = {
    message: answer.message.content,
    docs: similarDocs,
  };

  return new Response(
    JSON.stringify(data),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", 
      }
    },
  );
});
/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/prompt' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
