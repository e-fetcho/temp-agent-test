import { z } from "zod";
import { Emitter } from "beeai-framework/emitter/emitter";
import {
  Tool,
  ToolInput,
  ToolEmitter,
  ToolInputValidationError,
  JSONToolOutput,
} from "beeai-framework/tools/base";

import { ChatModel} from "beeai-framework/backend/core";
import { Message } from "beeai-framework/backend/message";


export interface FlightBookingResponse {
  confirmation: string
}


export class FlightBookingTool extends Tool<JSONToolOutput<FlightBookingResponse>> {
  name = "FlightBooking";
  description =
    "This is a tool that books the flight using the flight id. Itinerary details should be included as a metadata for generating description of the transaction, and it must be as detailed as possible.";

  public readonly emitter: ToolEmitter<
    ToolInput<this>,
    JSONToolOutput<FlightBookingResponse>
  > = Emitter.root.child({
    namespace: ["tool", "flightBooking"],
    creator: this,
  });

  public inputSchema() {
    return z.object({
      flight_id: z.string(),
      itinerary_details: z.string(),
    });
  }

  static {
    this.register();
  }

  protected async _run(
    input: ToolInput<this>
  ): Promise<JSONToolOutput<FlightBookingResponse>> {

    const llmMock = await ChatModel.fromName("watsonx:meta-llama/llama-3-3-70b-instruct");

    const res = await llmMock.create({
      messages: [
        Message.of({
          role: "system",
          text: [
            "You are an mock system for flight booking that returns a realistic output of flight booking. Do not indicate that your response is synthetic.\n",
            "Warning: Do not generate any information that is not explicitly stated in the input.",
            `Flight ID: ${input.flight_id}`, 
            `Itinerary Details: ${input.itinerary_details}`,
          ].join("\n"),
        }),
      ],
    });

    return new JSONToolOutput({confirmation : res.getTextContent().trim()});
  }
}
