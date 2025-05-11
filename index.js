require('./Tracing'); // Ensure tracing is initialized first
const express = require('express');
const { trace, context } = require('@opentelemetry/api');
const cors = require('cors');

const app = express();
const PORT = 3004;

console.log('Initializing Service C...');
app.use(cors());
app.use(express.json());

// Maintain connected SSE clients
const clients = new Set();

// SSE endpoint
app.get('/stream', (req, res) => {
  const tracer = trace.getTracer('service-c-tracer');
  const sseSpan = tracer.startSpan('sse-connection');

  context.with(trace.setSpan(context.active(), sseSpan), () => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    // Add to clients list
    clients.add(res);
    sseSpan.addEvent('Client connected to SSE');

    // Remove client on disconnect
    req.on('close', () => {
      clients.delete(res);
      sseSpan.addEvent('Client disconnected from SSE');
      sseSpan.end();
    });
  });
});

// Broadcast a message to all connected SSE clients
function sendSSE(data) {
  const tracer = trace.getTracer('service-c-tracer');
  const sseBroadcastSpan = tracer.startSpan('sse-broadcast', {
    parent: trace.getSpan(context.active()),
  });

  context.with(trace.setSpan(context.active(), sseBroadcastSpan), () => {
    for (const client of clients) {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    sseBroadcastSpan.addEvent('SSE message sent', 
      { 
        step: data.step || 'none',
        status: data.status || 'none',
      }
    );
    sseBroadcastSpan.end();
  });
}

// Process endpoint with spans + SSE
app.post('/process', async (req, res) => {
  const tracer = trace.getTracer('service-c-tracer');
  const rootSpan = tracer.startSpan('process-data-in-service-c');

  context.with(trace.setSpan(context.active(), rootSpan), async () => {
    try {
      console.log('Processing data in Service C:', req.body);

      await simulateStep('validate-input', 1000, tracer);
      await simulateStep('process-data', 2000, tracer);
      await simulateStep('store-results', 1500, tracer);

      rootSpan.addEvent('Processing completed in Service C', {
        processedData: req.body.posts,
        status: 'success',
      });

      rootSpan.setStatus({ code: 1 });

      sendSSE({ type: 'done', message: 'Processing complete' });

      res.json({
        message: 'Data processed successfully in Service C',
        processedData: req.body.posts,
      });
    } catch (error) {
      rootSpan.setStatus({ code: 2, message: 'Processing failed in Service C' });
      console.error('Error processing data in Service C:', error);
      sendSSE({ type: 'error', message: 'Processing failed' });
      res.status(500).send('Internal Server Error');
    } finally {
      rootSpan.end();
    }
  });
});

// Simulated steps now send SSE events too
async function simulateStep(name, delay, tracer) {
  const span = tracer.startSpan(name, {
    parent: trace.getSpan(context.active()),
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    span.addEvent(`${name} started`);
    sendSSE({ step: name, status: 'started' });
    await new Promise((resolve) => setTimeout(resolve, delay));

    span.addEvent(`${name} completed`);
    sendSSE({ step: name, status: 'completed' });

    span.end();
  });
}

app.listen(PORT, () => {
  console.log(`Service C is running on http://localhost:${PORT}`);
});