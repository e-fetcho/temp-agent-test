import { z } from "zod";
import axios from "axios";
import { Emitter } from "beeai-framework/emitter/emitter";
import {
  Tool,
  ToolInput,
  ToolEmitter,
  ToolInputValidationError,
  JSONToolOutput,
} from "beeai-framework/tools/base";

export interface FlightCostLookupResponse {
  itineraries: Itinerary[];
  legs: Leg[];
  segments: Segment[];
}

export interface Itinerary {
  id: string;
  pricing_options: PricingOption[];
}

export interface PricingOption {
  id: string;
  price: Price;
}

export interface Price {
  amount: number;
  update_status: string;
}

export interface Leg {
  id: string;
  origin_place_id: string;
  destination_place_id: string;
  departure: string;
  arrival: string;
}

export interface Segment {
  id: string;
  mode: string;
}

export class FlightCostLookupTool extends Tool<JSONToolOutput<FlightCostLookupResponse>> {
  name = "FlightCostLookup";
  description =
    "This tool will look up the cost and other information about flights you might want to book based on your details. Don't assume the missing details and ask the user for the details if missing. Dates must be provided in YYYY-MM-DD format.";

  public readonly emitter: ToolEmitter<
    ToolInput<this>,
    JSONToolOutput<FlightCostLookupResponse>
  > = Emitter.root.child({
    namespace: ["tool", "flightCostLookup"],
    creator: this,
  });

  public inputSchema() {
    return z.object({
      departure_airport_code: z.string(),
      arrival_airport_code: z.string(),
      departure_date: z.string(),
      number_of_adults: z.number(),
      number_of_children: z.number(),
      number_of_infants: z.number(),
      cabin_class: z.number(),
    });
  }

  static {
    this.register();
  }

  protected async _run(
    input: ToolInput<this>
  ): Promise<JSONToolOutput<FlightCostLookupResponse>> {
    const currency = "USD";

    const apiURL = [
      "https://backend-lm-agent-lm-agent.pubfed4-ocp-7e584e106e8632fde4ff5d99d5f27ba6-0000.us-south.containers.appdomain.cloud/cost",
      input.departure_airport_code,
      input.arrival_airport_code,
      input.departure_date,
      input.number_of_adults,
      input.number_of_children,
      input.number_of_infants,
      input.cabin_class,
      currency,
    ].join("/");

    try {
      const response = await axios.get<FlightCostLookupResponse>(apiURL);
      return new JSONToolOutput(response.data);
    } catch (error) {
      console.error("Failed to fetch flight cost data:", error);
      throw new ToolInputValidationError("Invalid input or data fetch failed.");
    }
  }
}
