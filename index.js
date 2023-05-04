const { Configuration, OpenAIApi } = require("openai");
const { poemStyles, poemTimes, poemAuthors } = require("./constants");

const streamingResponse = async (request) => {
  try {
    const res = await openai.createCompletion(request, {
      responseType: "stream",
    });

    res.data.on("data", (data) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim() !== "");
      for (const line of lines) {
        const message = line.replace(/^data: /, "");
        if (message === "[DONE]") {
          return; // Stream finished
        }
        try {
          const parsed = JSON.parse(message);
          console.log(parsed.choices[0].text);
        } catch (error) {
          console.error("Could not JSON parse stream message", message, error);
        }
      }
    });
  } catch (error) {
    if (error.response?.status) {
      console.error(error.response.status, error.message);
      error.response.data.on("data", (data) => {
        const message = data.toString();
        try {
          const parsed = JSON.parse(message);
          console.error("An error occurred during OpenAI request: ", parsed);
        } catch (error) {
          console.error("An error occurred during OpenAI request: ", message);
        }
      });
    } else {
      console.error("An error occurred during OpenAI request", error);
    }
  }
};

const queryCompletion = async (data) => {
  console.log("data", data);
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY ?? data.apiKey,
  });
  const openai = new OpenAIApi(configuration);
  const estimated_prompt_tokens = parseInt(
    data.prompt.split().length * 1.6,
    10
  );
  const request = {
    /**
     * ID of the model to use. You can use the [List models](/docs/api-reference/models/list) API to see all of your available models, or see our [Model overview](/docs/models/overview) for descriptions of them.
     * @type {string}
     * @memberof CreateCompletionRequest
     */
    model: data.model ?? "text-davinci-003",
    /**
     *
     * @type {CreateCompletionRequestPrompt}
     * @memberof CreateCompletionRequest
     */
    prompt: data.prompt ?? null,
    /**
     * The suffix that comes after a completion of inserted text.
     * @type {string}
     * @memberof CreateCompletionRequest
     */
    suffix: data.suffix ?? null,
    /**
     * The maximum number of [tokens](/tokenizer) to generate in the completion.  The token count of your prompt plus `max_tokens` cannot exceed the model\'s context length. Most models have a context length of 2048 tokens (except for the newest models, which support 4096).
     * @type {number}
     * @memberof CreateCompletionRequest
     */
    max_tokens:
      Math.min(4096 - estimated_prompt_tokens, data.max_tokens) ?? null,
    /**
     * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.  We generally recommend altering this or `top_p` but not both.
     * @type {number}
     * @memberof CreateCompletionRequest
     */
    temperature: data.temperature ?? null,
    /**
     * An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered.  We generally recommend altering this or `temperature` but not both.
     * @type {number}
     * @memberof CreateCompletionRequest
     */
    top_p: data.top_p ?? null,

    /**
     * Whether to stream back partial progress. If set, tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]` message.
     * @type {boolean}
     * @memberof CreateCompletionRequest
     */
    stream: data.stream ?? null,

    /**
     * Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model\'s likelihood to talk about new topics.  [See more information about frequency and presence penalties.](/docs/api-reference/parameter-details)
     * @type {number}
     * @memberof CreateCompletionRequest
     */
    presence_penalty: data.presence_penalty ?? null,
    /**
     * Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model\'s likelihood to repeat the same line verbatim.  [See more information about frequency and presence penalties.](/docs/api-reference/parameter-details)
     * @type {number}
     * @memberof CreateCompletionRequest
     */
    frequency_penalty: data.frequency_penalty ?? null,
  };
  console.log("request", request);
  if (request.stream) {
    return streamingResponse(request);
  } else {
    const completion = await openai.createCompletion(request);
    return completion.data.choices[0].text;
  }
};

const fineTurnedPrompt = (prompt = "", context = {}) => {
  return `
    Generate a poem with following conditions.

    Summarize with a context of ${prompt}.
    Like the style of author ${
      poemAuthors[context.author ?? "William Shakespeare"]
    }.
    In the time of ${poemTimes[context.time ?? "present"]} world.
    With style ${poemStyles[context.style ?? "ballad"]}
  `;
};

module.exports.handler = async (event) => {
  const messageResponse = {
    message: "response from server",
    data: {},
  };
  try {
    try {
      event.body = JSON.parse(event.body);
    } catch (error) {
      messageResponse.message = error.message;
      throw new Error(error.message);
    }
    try {
      const data = {
        ...event.body,
        prompt: fineTurnedPrompt(event.body.prompt),
        apiKey: event.headers.api_key,
        max_tokens: 500,
        temperature: 0.5,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0.2,
      };

      const response = await queryCompletion(data);
      messageResponse.data = response;
    } catch (error) {
      if (error.response) {
        console.log("status: ", error.response.status);
        console.log("data: ", error.response.data);
      } else {
        console.log(error.message);
      }
      messageResponse.message = error.message;
      throw new Error(error.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(messageResponse, null, 2),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify(messageResponse, null, 2),
    };
  }
};
exports.streamhandler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    const httpResponseMetadata = {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html",
        "X-Custom-Header": "type-streaming",
      },
    };

    responseStream = awslambda.HttpResponseStream.from(
      responseStream,
      httpResponseMetadata
    );

    responseStream.write("<html>");

    responseStream.end();
  }
);
