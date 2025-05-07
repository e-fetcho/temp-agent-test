import sqlite3 from "sqlite3";
import path from "path";
import { Emitter } from "beeai-framework/emitter/emitter";
import {
  Tool,
  ToolInput,
  ToolEmitter,
  ToolInputValidationError,
  StringToolOutput,
} from "beeai-framework/tools/base";
import { OllamaChatModel } from "beeai-framework/adapters/ollama/backend/chat";
import { Message } from "beeai-framework/backend/message";
import { z, ZodTypeAny } from "zod";

export class ReminderTool extends Tool<StringToolOutput> {
  name = "ReminderTool";
  description = `
Manages and executes reminder operations on reminder.db with dynamic SQL generation. 
Your input must be a SINGLE complete natural language instruction describing the reminder task to perform.`;

  public readonly emitter: ToolEmitter<ToolInput<this>, StringToolOutput> =
    Emitter.root.child({
      namespace: ["tool", "reminder"],
      creator: this,
    });

  public inputSchema() {
    return z.object({
      naturalLanguageInput: z.string(),
    });
  }

  private db = new sqlite3.Database(path.resolve("reminder.db"));

  private maxReminders = 10;

  private exampleQueries = `
Example SQL queries:
1. Add Reminder:
   INSERT INTO reminders (name, created_date, original_due_date, active_due_date, priority, description)
   VALUES (?, ?, ?, ?, ?, ?);

2. Delete Reminder:
   DELETE FROM reminders WHERE id = ?;

3. Snooze Reminder:
   UPDATE reminders SET snoozed_count = snoozed_count + 1, active_due_date = datetime(active_due_date, '+30 minutes') WHERE id = ?;

4. Check Reminders:
   SELECT * FROM reminders;
  `;

  static {
    // Makes the class serializable
    this.register();
  }

  protected async _run(input: ToolInput<this>): Promise<StringToolOutput> {
    const naturalLanguageTask = input.naturalLanguageInput ?? "";

    if (naturalLanguageTask === "") {
      return new StringToolOutput("⚠️ No input was found, nothing was done.");
    }

    console.log("Received task:", naturalLanguageTask);

    if (naturalLanguageTask.toLowerCase().includes("add")) {
      const total = await this.query(
        "SELECT COUNT(*) as total FROM reminders;"
      );
      const totalReminders = JSON.parse(total)[0].total;
      if (totalReminders >= this.maxReminders) {
        return new StringToolOutput(
          "⚠️ You have too many reminders... As per the limit you set, try to complete other tasks first!"
        );
      }
    }

    const llmParse = new OllamaChatModel("granite3.1-dense:8b")
    const structuredTaskResponse = await llmParse.create({
      messages: [
        Message.of({
          role: "system",
          text: [
            "You are an orchestrator that converts natural language reminder requests into structured task descriptions.",
            "Your goal is to classify the user's intent into one of the following categories, prefixed exactly as shown:",
            "",
            "1. Add a Reminder:",
            "2. Delete a Reminder:",
            "3. Snooze a Reminder:",
            "4. Check Reminders:",
            "",

            "Respond with the most appropriate category and rephrase the task clearly.",
            "Do NOT add any extra explanations or text.",
            "",
            `User Task: `,
            naturalLanguageTask,
            "Structured Rephrased Task: ",
          ].join("\n"),
        }),
      ],
    });

    const currentDB = await this.query("SELECT * FROM reminders;");

    const dbContext =
      "\n------------------------------------------------------\n" +
      currentDB +
      "\n------------------------------------------------------\n";

    console.log({ dbContext });

    const structuredTask = structuredTaskResponse.getTextContent().trim();
    console.log("Structured Task:", structuredTask);

    const llmFix = new OllamaChatModel("granite3.1-dense:8b")
    const validationResponse = await llmFix.create({
      messages: [
        Message.of({
          role: "system",
          text: [
            "You are a validator ensuring that the structured task refers to valid reminders in the database.",
            "If the task references an ID that doesn't exist, find the closest valid ID or entry.",
            "Provide ONLY the validated ID if applicable, or null if none.",
            "",
            `# Current Database:`,
            dbContext,
            "",
            `# Structured Task:`,
            structuredTask,
            "",
            "Respond ONLY with the JSON format:",
            `{"validId": number | null, "notes": "optional notes if correction was applied"}`,
          ].join("\n"),
        }),
      ],
    });

    const regex = /\{(?:[^{}]|\{[^{}]*\})*\}/s;
    const match = validationResponse.getTextContent().trim().match(regex);

    const extracted = match ? match[0] : "";

    const { validId, notes } = JSON.parse(extracted);
    console.log("Validated ID:", validId, "Notes:", notes);

    const generated = await this.generateQuery(
      validId ? `${structuredTask} (Validated Target ID: ${validId})` : structuredTask
    );
    const sqlResult = await this.query(generated.query, generated.params);

    console.log(sqlResult)

    const llmResponse = new OllamaChatModel("granite3.1-dense:8b")
    const finalResponse = await llmResponse.create({
      messages: [
        Message.of({
          role: "system",
          text: [
            "You are an assistant providing a clear success confirmation for reminder tasks.",
            "",
            "# Original Task",
            naturalLanguageTask,
            "",
            "# Generated SQL Query",
            generated.query,
            "",
            "# SQL Result",
            sqlResult,
            "",
            "Based on this information, reply to the user confirming the outcome of their request in a friendly and helpful way. Avoid technical details about SQL and keep the response clear and simple.",
            "If there is no SQL Result go to off of, assume success."
          ].join("\n"),
        }),
      ],
    });

    return new StringToolOutput(finalResponse.getTextContent().trim());
  }

  private async generateQuery(taskDescription: string): Promise<{
    query: string;
    params: any[];
  }> {
    const prompt = `
You are an expert SQL generator for a reminders database. Based on the task description and the following example queries, generate the appropriate SQL query and parameters.

${this.exampleQueries}

Task: ${taskDescription}

Respond ONLY with JSON in the following format:
{
  "query": "SQL QUERY HERE",
  "params": [PARAMETERS_ARRAY_HERE]
}
    `;

    const llmGenerate = new OllamaChatModel("codellama:7b")
    const response = await llmGenerate.create({
      messages: [
        Message.of({
          role: "system",
          text: prompt.trim(),
        }),
      ],
    });

    const text = response.getTextContent();

    const regex = /\{(?:[^{}]|\{[^{}]*\})*\}/s;
    const match = text.match(regex);

    const extracted = match ? match[0] : "";

    console.log(text, extracted);

    return JSON.parse(extracted);
  }

  private async query(query: string, params: any[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          return reject(new ToolInputValidationError(err.message));
        }
        resolve(JSON.stringify(rows));
      });
    });
  }
}
