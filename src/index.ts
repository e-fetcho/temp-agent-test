import express, { Request, Response } from "express";

import { BeeAgent } from "beeai-framework/agents/bee/agent";
import { TokenMemory } from "beeai-framework/memory/tokenMemory";
import { FrameworkError } from "beeai-framework/errors";
import { FlightCostLookupTool } from "./Tools/FlightCostLookupTool.js";
import { CalculatorTool } from "./Tools/calculator.js";

import { ChatModel } from "beeai-framework/backend/core";

import "dotenv/config";
import { FlightBookingTool } from "./Tools/FlightBookingTool.js";

import { v4 as uuidv4 } from "uuid";

interface User {
  auth_method: "bearer" | "api_key";
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const app = express();

app.use(express.json());

const host: string = "0.0.0.0";
const port: number = 9997;

const memory = new TokenMemory();

const ASSISTANT_RESPONSE = "thread.message.delta";
const THINKING_STEP = "thread.run.step.delta";
const TOOL_CALL = "thread.run.step.delta";
const TOOL_RESPONSE = "thread.run.step.delta";

// Helper function to stream SSE response
const sseEvent = (targetStr: string, res: Response, messageType: String) => {
  const content = {
    id: `run-${uuidv4().slice(0, 8)}`,
    object: messageType,
    thread_id: uuidv4(),
    model: "crewai-example",
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        delta: {
          role: "assistant",
          content: targetStr,
        },
      },
    ],
  };

  res.write(`data: ${JSON.stringify(content)}\n\n`);
};

async function handleQueryMain(query: string, res: Response): Promise<string> {
  const llm = await ChatModel.fromName(
    "watsonx:ibm/granite-3-8b-instruct"
  );

  memory.reset();
  const agent = new BeeAgent({
    llm,
    memory,
    tools: [new FlightCostLookupTool(), new FlightBookingTool(), new CalculatorTool()],
  });

  const systemPrompt: string = `
You are an agent designed to assist the user to the best of your abilities using the tools you have available.
Carefully interpret their request and execute the most appropriate actions to help them.
--------------------------------------------------------
# User Wants to:
${query}
  `.trim();

  const response = await agent
    .run(
      { prompt: systemPrompt },
      {
        execution: {
          maxRetriesPerStep: 3,
          totalMaxRetries: 10,
          maxIterations: 20,
        },
      }
    )
    .observe((emitter) => {
      emitter.on("error", ({ error }) => {
        console.log(FrameworkError.ensure(error).dump());
      });
      emitter.on("retry", () => {
        console.log("retry")
      });
      emitter.on("update", async ({ data, update, meta }) => {
        console.log(`\n\nUpdate (${update.key}):`, update.value);
        if (update.key == "thought") {
          sseEvent("<h3>Agent is thinking: </h3> <br/>" + update.value + "\n\n <br/>", res, THINKING_STEP);
        }
        if (update.key === "tool_name") {
          sseEvent(
            "<h3>Tool <i>" + update.value + "</i> is being invoked.</h3> \n\n",
            res,
            TOOL_CALL
          );
        }
        if (update.key === "tool_input") {
          sseEvent(
            "<h3>Tool call initialized with input:</h3> \n" +
              "\n-------------------------------------------\n" +
              "```" +
              update.value +
              "```\n\n" +
              "\n-------------------------------------------\n",
            res,
            THINKING_STEP
          );
        }
        if (update.key === "tool_output") {
          sseEvent(
            "<h3>Tool returned output:</h3> \n" +
              "\n-------------------------------------------\n" +
              "```" + 
              update.value +
              "```\n\n" +
              "\n-------------------------------------------\n",
            res,
            TOOL_RESPONSE
          );
        }
      });
      emitter.on("partialUpdate", ({ data, update, meta }) => {
        process.stdout.write(update.value);
      });
    });

  return response.result.text;
}

app.get("/query", async (req: Request, res: Response): Promise<void> => {
  const userQuery = req.query.q as string | undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (!userQuery) {
    res.status(400).json({ error: 'Missing query parameter "q"' });
    return;
  }

  try {
    const result = await handleQueryMain(userQuery, res);
    //res.json({ message: "Query processed", result });
    sseEvent(result, res, ASSISTANT_RESPONSE);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error: any) {
    res.status(500).json({ error: error.toString() });
  }
});

app.post("/", async (req: Request, res: Response) => {
  const threadId = req.headers["x-ibm-thread-id"] || uuidv4();

  console.log(`Received request with thread_id: ${threadId}`);

  const messages = req.body.messages;
  const latestMessage = messages[messages.length - 1];
  console.log(latestMessage);

  const context = messages.reduce((acc: string, cur: any) => acc + `${cur.role}: ` + cur.content + "\n", "")

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const result = await handleQueryMain(context, res);
  console.log(result);

  sseEvent("<h2> Final Response: </h2> <br/>" +result, res, ASSISTANT_RESPONSE);

  res.write("data: [DONE]\n\n");
  res.end();
});

app.listen(port, host, () => {
  console.log(`Agent listening at http://${host}:${port}`);
});
