// Imported FIRST by a test file that wants payment-api's local fake gateway (its fake methods, its onboarding
// and the /dev/fake-gateway controls): payment-api's AppModule decides at import time whether to mount them.
// pos-api itself does not read this variable.
process.env.PAYMENT_ADAPTERS = 'fake';
