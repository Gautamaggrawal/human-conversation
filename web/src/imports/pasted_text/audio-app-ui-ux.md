Design a complete, production-quality mobile app UI/UX for a new audio-only human conversation app.

The core idea is extremely simple:

“I want to talk → I choose how long → I get connected to a real person → we talk → I rate the conversation → I can talk to that same person again.”

The app should feel like the fastest and safest way to have a genuine conversation with another human being.

Do NOT design this as a social media app, dating app, messaging app, or content platform.

There should be:

* No feed
* No stories
* No follower counts
* No likes
* No public posts
* No complicated profiles
* No video calls
* No gifts
* No unnecessary gamification
* No clutter

The product should feel extremely simple, premium, calm, human, trustworthy, and fast.

TARGET USERS

People who:

* Want someone to talk to right now
* Feel lonely, bored, stressed, or simply want human company
* Prefer talking to a real person rather than chatting with an AI
* Want short conversations of 10, 20, or 30 minutes
* May discover someone they genuinely enjoy talking to and want to talk to them again

The primary user action is:

“TALK NOW”

PRODUCT PRINCIPLE

The entire app should revolve around one primary loop:

Need someone
↓
Talk
↓
Good conversation
↓
Rate conversation
↓
Find “my people”
↓
Talk again
↓
Come back

DESIGN DIRECTION

Create a premium modern mobile experience inspired by the simplicity of Apple-quality consumer apps.

Visual characteristics:

* Minimal
* Warm
* Human
* Calm
* Premium
* Extremely clean
* Lots of breathing room
* Strong typography
* Soft rounded corners
* Subtle shadows
* Beautiful but restrained animations
* Large touch targets
* Clear hierarchy
* One obvious primary action per screen

Avoid:

* Overly colorful interfaces
* Excessive gradients
* Neon colors
* Gaming aesthetics
* Dating-app aesthetics
* Corporate SaaS aesthetics
* Excessive cards
* Dense information
* Tiny text
* Too many buttons

Use a neutral, sophisticated color system.

Suggested palette:

* Warm off-white background
* Near-black primary text
* Soft gray secondary text
* One warm accent color for the primary CTA
* Very subtle green for “available/connected”
* Very subtle red for destructive actions

Use the accent color sparingly.

TYPOGRAPHY

Use a modern highly legible sans-serif typeface.

Typography should feel similar in spirit to:

* SF Pro
* Inter
* Geist

Use:

* Large bold headlines
* Medium-weight body text
* Clear secondary text
* Large readable numbers for call duration
* Strong button labels

Avoid excessive font sizes and excessive font weights.

PLATFORM

Design for mobile first.

Primary target:

* iPhone
* 390 × 844 style viewport

The UI should also adapt naturally to Android.

Create reusable components so the design can later be implemented in React Native.

NAVIGATION

Keep navigation extremely simple.

Use a bottom navigation bar with only three destinations:

1. Home
2. People
3. Profile

Home is the default and most important screen.

Do not add unnecessary navigation items.

---

## SCREEN 1 — HOME

The home screen should immediately answer:

“Can I talk to someone right now?”

Top:

Small greeting such as:

“Good evening, Gautam”

Below it:

“Want to talk?”

Large headline.

Supporting text:

“Connect with someone who’s ready to listen.”

Then show the primary action:

[TALK NOW]

This should be the most visually prominent element on the entire screen.

Below the button, show a subtle availability indicator:

“People are available now”

Do not show fake precise numbers.

Optionally show a small abstract stack of anonymous circular avatars to communicate that real people are available.

Below that, show a very small section:

“Talk again”

If the user has previously talked to people, display 2–3 compact person cards.

Each card should contain:

* Anonymous or first-name-only avatar
* First name
* Small descriptor such as “Great conversation”
* “Talk again” action

If there are no previous conversations, show:

“Your favorite conversations will appear here.”

The screen should feel almost empty.

The user should immediately understand that pressing TALK NOW starts a real conversation.

---

## SCREEN 2 — CHOOSE DURATION

When the user taps TALK NOW, show a clean duration selection screen.

Headline:

“How long do you want to talk?”

Three large selectable options:

10 min
20 min
30 min

Each option should be a large rounded card/button.

10 min should be selected by default.

Show a small description:

“Choose a time that feels right.”

Primary CTA:

“Find someone”

Secondary text:

“You can end the conversation anytime.”

Do not introduce coins or complicated pricing in this first version.

The duration selection should be extremely fast.

---

## SCREEN 3 — FINDING SOMEONE

After selecting the duration, transition to a connecting screen.

Headline:

“Finding someone for you…”

Subtext:

“Looking for someone who’s ready to talk.”

Use a beautiful subtle animated loading state.

Do not use a generic spinning loader if possible.

Use a soft pulsing avatar / connection animation.

After a short simulated delay, transition to the incoming connection state.

Include:

“Almost there…”

This screen should communicate speed and reliability.

---

## SCREEN 4 — CONNECTION FOUND

Show the person who has been matched.

Large circular avatar.

First name only.

Example:

“Meet Maya”

Small descriptor:

“Available for a 20 minute conversation”

Optional small trust indicators:

✓ Verified
✓ Good conversation history

Do NOT show follower counts, popularity, number of calls, or public statistics.

Primary button:

“Start talking”

Secondary option:

“Find someone else”

The screen should make the person feel human and trustworthy without turning them into a dating profile.

---

## SCREEN 5 — AUDIO CALL

Create a beautiful full-screen audio call interface.

This is the most important interaction in the app.

Display:

Large circular avatar

“Maya”

“Talking”

Large countdown timer:

18:42

The timer should be extremely easy to read.

Controls at the bottom:

Mute
Speaker
End

The END button should be visually distinct but not alarming.

Do not show unnecessary information.

During the call, provide subtle connection status.

Example:

“Excellent connection”

If the connection becomes poor:

“Connection is unstable”

Do not expose technical WebRTC terminology.

Include subtle animation around the avatar to communicate that audio is active.

The call screen should feel calm and intimate, similar to a high-quality phone call rather than a video conferencing application.

---

## SCREEN 6 — CALL ENDING

When the timer reaches zero or the user ends the call, show a short transition:

“Conversation ended”

Then automatically move to rating.

Do not make the user navigate through unnecessary screens.

---

## SCREEN 7 — RATE THE CONVERSATION

Headline:

“How was the conversation?”

Show five large star buttons or another extremely intuitive rating interaction.

Below:

“Would you talk to Maya again?”

Two large choices:

“Yes, definitely”
“Maybe later”

Then optional tags:

Great listener
Easy to talk to
Made me smile
Interesting
Helpful
Felt natural

Allow multiple tags.

Optional text field:

“Anything you want to remember?”

Keep this optional.

Primary CTA:

“Done”

The rating should take less than 10 seconds.

---

## SCREEN 8 — TALK AGAIN

After rating, show:

“Good conversations are worth keeping.”

Then show Maya's profile card.

“Maya”

“Great conversation”

Primary button:

“Talk again”

Secondary:

“Maybe later”

If the user chooses Talk again, immediately start the connection flow.

Do not force them back to the home screen.

---

## SCREEN 9 — PEOPLE

Create the second bottom navigation destination.

Title:

“People”

Subtitle:

“People you’ve enjoyed talking to.”

Display a simple vertical list of previous conversation partners.

Each row:

Avatar
First name
Short descriptor
Last conversation date
Talk again button

Example:

Maya
“Great listener”
Talk again

Alex
“Easy conversation”
Talk again

Do not show social metrics.

Do not turn this into a social network.

This is essentially the user's personal collection of people they enjoyed talking with.

---

## SCREEN 10 — PERSON DETAIL

When tapping a person, show a minimal profile.

Large avatar.

Name.

Small verification badge.

Short description.

Conversation history:

“3 conversations”

Show dates and durations.

Primary CTA:

“Talk again”

Secondary:

“Remove from people”

Keep the profile intentionally minimal.

The product is about the conversation, not the profile.

---

## SCREEN 11 — PROFILE

Create a simple profile/settings screen.

Avatar

First name

Short personal introduction

Availability status:

“Available to talk”

Settings:

Notifications
Privacy
Safety
Account
Help

Include a clear logout option.

Keep everything extremely simple.

---

## SCREEN 12 — ONBOARDING

Create a short onboarding flow.

Screen 1:

“Sometimes, you just want someone to talk to.”

Screen 2:

“Real people. Real conversations.”

Screen 3:

“Find someone in seconds.”

Screen 4:

“Talk for 10, 20, or 30 minutes.”

Final CTA:

“Start talking”

Do not make onboarding longer than necessary.

---

## SCREEN 13 — SAFETY

Create a simple safety screen accessible during and after calls.

Title:

“Your safety matters.”

Include:

Report someone
Block someone
Leave conversation
Get help

During a call, provide a small “…” menu containing:

Report
Block
End call

The safety controls should be easy to access but should not visually dominate the call screen.

---

## LISTENER / TALKER AVAILABILITY

The product has two roles:

1. Person who wants to talk
2. Person who is available to talk

Create a simple availability mode in the profile/settings area.

Toggle:

“Available to talk”

When enabled:

“You’re available”

Show:

“People may connect with you for conversations.”

Keep this extremely simple.

Do not create a complex listener dashboard in the first version.

---

## EMPTY STATES

Design polished empty states for:

No previous conversations
No saved people
No one currently available
No internet connection
Call failed
Person disconnected
Microphone permission denied

Examples:

“No one is available right now.”

“Try again in a moment.”

For connection errors:

“We lost the connection.”

“Try again”

Keep error messages human and non-technical.

---

## PERMISSION SCREENS

Create custom pre-permission screens before requesting microphone access.

Headline:

“Your microphone lets you talk.”

Subtext:

“We need microphone access to start your conversation.”

Button:

“Allow microphone”

Do not request unnecessary permissions.

---

## DESIGN SYSTEM

Create a reusable design system.

Include:

Color tokens
Typography tokens
Spacing system
Corner radius system
Buttons
Cards
Avatar components
Navigation
Bottom sheets
Modals
Toast messages
Loading states
Error states
Rating components
Call controls

Use an 8-point spacing system where practical.

Use large touch targets suitable for mobile.

Components should be structured so they can later be implemented cleanly in React Native.

---

## INTERACTIONS

Create an interactive prototype for the primary flow:

Home
→ Talk Now
→ Choose duration
→ Find someone
→ Connection found
→ Start talking
→ Audio call
→ End
→ Rate
→ Talk again

Make transitions feel fast.

Use subtle animations rather than flashy animations.

Recommended transition behavior:

Home → duration:
smooth upward transition

Duration → connecting:
quick fade/slide

Connecting → person:
smooth reveal

Person → call:
full-screen transition

Call → rating:
soft transition

Rating → talk again:
immediate response

The application should feel extremely responsive.

---

## IMPORTANT PRODUCT PHILOSOPHY

The most important screen is HOME.

The most important button is:

“TALK NOW”

The most important metric conceptually is:

Time from tapping TALK NOW to hearing another human being.

Design the interface to minimize every unnecessary step.

A user should be able to open the app and start talking within a few seconds.

The app should feel:

“Open → Talk.”

Not:

“Open → Browse → Scroll → Search → Match → Chat → Schedule.”

---

## VISUAL QUALITY

Make this look like a serious startup product ready for App Store launch.

Do not make it look like an AI-generated template.

Use:

* Excellent spacing
* Consistent alignment
* High-quality typography
* Strong visual hierarchy
* Sophisticated empty states
* Subtle micro-interactions
* Beautiful avatars
* Carefully designed icons
* Consistent corner radii
* Consistent button heights

Every screen should feel like part of the same product.

Create both light mode and dark mode.

Use realistic sample names and content, but keep the design generic enough to replace with real user data.

---

## FINAL PROTOTYPE

Create all screens and connect the main interactions.

The final prototype should allow me to experience this complete journey:

Open app
→ See “Want to talk?”
→ Tap TALK NOW
→ Select 10/20/30 minutes
→ Find someone
→ Meet the person
→ Start audio call
→ See countdown
→ End call
→ Rate conversation
→ Decide whether to talk again
→ Talk again

Prioritize simplicity, speed, trust, human connection, and repeat conversations above everything else.

The final result should feel like a completely new category of consumer app built around one powerful idea:

“Whenever you want to talk, there’s a real person ready to talk with you.”
