// Imported FIRST by a test file that wants the local fake gateway (src/adapters/fake): AppModule decides at
// import time whether to mount its control routes, so the variable must be set before AppModule is loaded.
process.env.PAYMENT_ADAPTERS = 'fake';
