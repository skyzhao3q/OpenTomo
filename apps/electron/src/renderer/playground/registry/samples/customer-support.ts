/**
 * Customer Support Escalation Workflow Sample
 * Cross-platform support flow demonstrating service integration
 */

import type { ActivityItem, ResponseContent } from '@opentomo/ui'
import { nativeToolIcons, sourceIcons } from '../sample-icons'

const now = Date.now()

// Activity 1: Gmail - Read customer complaint
const gmailReadComplaint: ActivityItem = {
  id: 'support-1',
  type: 'tool',
  status: 'completed',
  toolName: 'mcp__gmail__api_gmail',
  toolInput: {
    path: 'gmail/v1/users/me/messages/19abc123def',
    method: 'GET',
    _intent: 'Reading customer complaint email about billing issue',
    _displayName: 'Read Email',
  },
  intent: 'Reading customer complaint email about billing issue',
  displayName: 'Read Email',
  toolDisplayMeta: {
    displayName: 'Gmail',
    category: 'source',
    iconDataUrl: sourceIcons.gmail,
  },
  timestamp: now - 60000,
}

// Activity 2: PostgreSQL - Query customer data
const psqlQuery: ActivityItem = {
  id: 'support-5',
  type: 'tool',
  status: 'completed',
  toolName: 'Bash',
  toolInput: {
    command: 'psql $DATABASE_URL -c "SELECT * FROM users WHERE email = \'sarah@example.com\' LIMIT 1"',
    description: 'Querying customer account data from database',
  },
  intent: 'Querying customer account data from database',
  toolDisplayMeta: {
    displayName: 'PostgreSQL',
    category: 'native',
    iconDataUrl: nativeToolIcons.postgresql,
  },
  timestamp: now - 40000,
}

// Activity 6: Sentry - Check for errors in timeframe
const sentryErrors: ActivityItem = {
  id: 'support-6',
  type: 'tool',
  status: 'completed',
  toolName: 'mcp__sentry__sentry_search_issues',
  toolInput: {
    query: 'user.email:sarah@example.com is:unresolved',
    _intent: 'Checking for any errors affecting this customer',
    _displayName: 'Search Issues',
  },
  intent: 'Checking for any errors affecting this customer',
  displayName: 'Search Issues',
  toolDisplayMeta: {
    displayName: 'Sentry',
    category: 'source',
    iconDataUrl: sourceIcons.sentry,
  },
  timestamp: now - 35000,
}

// Activity 7: ClickUp - Create support ticket
const clickupTicket: ActivityItem = {
  id: 'support-7',
  type: 'tool',
  status: 'completed',
  toolName: 'mcp__clickup__clickup_create_task',
  toolInput: {
    list_id: 'support-queue',
    name: 'Billing Issue - Double charge for sarah@example.com',
    description: 'Customer reports being charged twice for January subscription',
    priority: 2,
    _intent: 'Creating support ticket for tracking and follow-up',
    _displayName: 'Create Task',
  },
  intent: 'Creating support ticket for tracking and follow-up',
  displayName: 'Create Task',
  toolDisplayMeta: {
    displayName: 'ClickUp',
    category: 'source',
    iconDataUrl: sourceIcons.clickup,
  },
  timestamp: now - 30000,
}

// Activity 8: Slack - Escalate to engineering
const slackEscalate: ActivityItem = {
  id: 'support-8',
  type: 'tool',
  status: 'completed',
  toolName: 'mcp__slack__slack_send_message',
  toolInput: {
    channel: '#billing-engineering',
    text: '⚠️ Customer billing issue: Double charge detected for cus_abc123. Invoice in_xyz789 appears to be a duplicate. Can someone verify the payment processor logs?',
    _intent: 'Escalating to billing engineering team for investigation',
    _displayName: 'Send Message',
  },
  intent: 'Escalating to billing engineering team for investigation',
  displayName: 'Send Message',
  toolDisplayMeta: {
    displayName: 'Slack',
    category: 'source',
    iconDataUrl: sourceIcons.slack,
  },
  timestamp: now - 25000,
}

// Activity 6: Gmail - Draft response to customer
const gmailResponse: ActivityItem = {
  id: 'support-10',
  type: 'tool',
  status: 'completed',
  toolName: 'mcp__gmail__api_gmail',
  toolInput: {
    path: 'gmail/v1/users/me/drafts',
    method: 'POST',
    body: {
      to: 'sarah@example.com',
      subject: 'Re: Billing Issue - Refund Processed',
      body: 'Dear Sarah, We apologize for the inconvenience...',
    },
    _intent: 'Drafting apology and resolution email to customer',
    _displayName: 'Create Draft',
  },
  intent: 'Drafting apology and resolution email to customer',
  displayName: 'Create Draft',
  toolDisplayMeta: {
    displayName: 'Gmail',
    category: 'source',
    iconDataUrl: sourceIcons.gmail,
  },
  timestamp: now - 5000,
}

export const customerSupportActivities: ActivityItem[] = [
  gmailReadComplaint,
  psqlQuery,
  sentryErrors,
  clickupTicket,
  slackEscalate,
  gmailResponse,
]

export const customerSupportResponse: ResponseContent = {
  text: `## Support Case Resolved

### Customer
**Sarah Thompson** (sarah@example.com)
- Customer ID: \`cus_abc123\`
- Plan: Pro ($49/month)
- Member since: March 2024

### Issue Summary
Customer was charged twice for the January 2026 subscription:
- Invoice \`in_xyz789\`: $49.00 (Jan 1) ✅ Legitimate
- Invoice \`in_xyz790\`: $49.00 (Jan 3) ❌ Duplicate

### Root Cause
A payment processing error caused the charge to be retried, resulting in a duplicate charge. This is a known edge case when payment webhook responses time out.

### Resolution
1. **Refund Issued**: $49.00 refund processed
   - Expected to appear in 5-10 business days
2. **Support Ticket**: Created in ClickUp (#SUP-4521)
3. **Engineering Notified**: Posted to #billing-engineering for investigation

### Customer Communication
Draft email prepared with:
- Sincere apology for the inconvenience
- Confirmation of refund details
- 10% discount code for next renewal (SORRY10)

### Follow-up Actions
- [ ] Engineering to review payment webhook timeout handling
- [ ] Add duplicate charge detection to billing pipeline
- [ ] Follow up with customer in 7 days to confirm refund received

The draft email is ready for review before sending.`,
  isStreaming: false,
}
