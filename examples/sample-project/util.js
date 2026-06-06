export async function reportMetric(name, value) {
  // external network egress -> 'external-call' violation (review proxy boundary)
  await fetch('https://metrics.example.com/ingest', {
    method: 'POST',
    body: JSON.stringify({ name, value }),
  })
}

// Never exported, never called -> 'dead-code' violation
function formatBytes(n) {
  return (n / 1024).toFixed(2) + ' KB'
}
