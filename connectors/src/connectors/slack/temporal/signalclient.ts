import { launchSlackBotJoinedWorkflow } from "./client";

async function myf() {
  const res = await launchSlackBotJoinedWorkflow("53", "channel-3");
  if (res.isErr()) {
    throw new Error(res.error.message);
  }

  // await new Promise((resolve) => setTimeout(resolve, 8000));
  // console.log("sleeping 9 sec");
  // const res1 = await launchSlackBotJoinedWorkflow("53", "channel-2");
  // if (res1.isErr()) {
  //   throw new Error(res1.error.message);
  // }
}

myf()
  .then(() => console.log("done"))
  .catch((e) => console.log(e));
