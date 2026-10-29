# What a `claude -p` result cost, as `bot` and `worker` log it: `jq -L <this folder> 'include "usage"; ... usage'`
def usage: {turns: .num_turns, cost_usd: .total_cost_usd, denials: ((.permission_denials // []) | length),
  tokens_in: ((.usage // {}) | .input_tokens + .cache_read_input_tokens + .cache_creation_input_tokens),
  tokens_cached: .usage.cache_read_input_tokens, tokens_out: .usage.output_tokens};
