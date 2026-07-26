# Custom Tracker in Conversation

Custom Tracker keeps a small set of facts that you define for one Conversation chat. Use it for details that should remain explicit and easy to correct, such as a relationship status, current objective, promise, location, counter, or preference.

This is different from Memory Recall and summaries. Those features derive broad context from conversation history. Custom Tracker stores only the named fields you choose, shows their current values, and adds the latest committed values to the next prompt while the agent is enabled.

## Set it up

1. Install **Custom Tracker** from **Agents → Download Agents**.
2. Open a Conversation chat and go to **Chat Settings → Agents**.
3. Add **Custom Tracker** to the chat.
4. Use the **Custom Tracker** button in the chat toolbar to open the tracker panel.
5. Enter add mode in the panel, add as many fields as you need, and click a field name or value to edit it.

Fields are scoped to the current chat. Disabling Custom Tracker stops automatic updates and prompt injection but does not delete the stored fields.

## Lock a value

Enter lock mode in the tracker panel, then select the name or value you want to protect. Automatic tracker updates preserve locked fields until you unlock them. Manual edits save through the same chat snapshot system as automatic updates.

## Branches, swipes, and regeneration

Tracker values follow the committed message or swipe snapshot. Switching a swipe, regenerating a reply, deleting later messages, or branching restores the tracker state associated with that conversation point rather than leaking newer values backward.
