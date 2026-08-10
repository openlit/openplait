SELECT
  SpanAttributes['gen_ai.request.model'] AS `model`,
  avg(Duration) AS `average_latency`
FROM `otel_traces`
WHERE Timestamp BETWEEN {op_0:DateTime64(9)} AND {op_1:DateTime64(9)}
  AND ServiceName = {op_2:String}
GROUP BY SpanAttributes['gen_ai.request.model']
ORDER BY `average_latency` DESC
LIMIT 20
