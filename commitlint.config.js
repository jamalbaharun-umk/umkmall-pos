module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [1, 'always', ['api', 'web', 'db', 'auth', 'tenancy', 'catalog', 'sales', 'shifts', 'store-cash', 'stock', 'staff', 'reports', 'purchasing', 'members', 'vouchers', 'receivables', 'purge', 'payments', 'payment-api', 'ci', 'docs', 'team']],
    'subject-max-length': [1, 'always', 100],
  },
};
