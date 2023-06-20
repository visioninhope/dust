import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { get_encoding } from "tiktoken";

import { getPullRequestFilesPage, GithubIssue } from "./github_api";
const MAX_TOKENS = 12_000;

const { DUST_API = "https://dust.tt" } = process.env;

export async function getAiGeneratedSummary(
  connectorId: string,
  installationId: string,
  repoName: string,
  login: string,
  issue: GithubIssue
): Promise<string> {
  let resultPage = 1;
  let diff = "";
  for (;;) {
    const files = await getPullRequestFilesPage(
      installationId,
      repoName,
      login,
      issue.number,
      resultPage
    );
    if (!files.length) {
      break;
    }
    diff += files.reduce((acc, file) => {
      return (
        acc +
        (!shouldUseFileDiff(file.filename)
          ? ""
          : `|fileUrl:${file.raw_url}|filePatch:${file.patch}|`)
      );
    }, "");

    resultPage += 1;
  }
  const text = `title:${issue.title}||body:${issue.body}||diff:${diff}||`;
  const enc = get_encoding("gpt2");
  const tokens = enc.encode(text);
  const tokensToSummarize = tokens.slice(0, MAX_TOKENS);
  const textToSummarize = new TextDecoder().decode(
    enc.decode(tokensToSummarize)
  );
  const dustRes = await axios.post(
    "https://dust.tt/api/v1/w/78bda07b39/apps/d1084cbcaa/runs",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer`,
      },
      body: JSON.stringify({
        specification_hash:
          "b68e2476aa2192a849faa05c3e68e6fb1141a57db9c771bd836c7b603399272f",
        config: {
          MODEL: {
            provider_id: "openai",
            model_id: "gpt-3.5-turbo-16k-0613",
            function_call: null,
            use_cache: true,
          },
        },
      }),
    }
  );
  return textToSummarize;
}

function shouldUseFileDiff(filename: string): boolean {
  return !filename.includes("package-lock");
}
