## Integration strategy

- LLM output is buffered filly before any client streaming.
- Grounding runs on the full buffered response.
- Only verified content is streamed to the client.
- Fail-closed responses are server-generated, not LLM-generated.
- Cancel always win: no response is sent if cancel is recieved at any stage.