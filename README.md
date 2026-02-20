# BeBetter

A social platform for tracking meaningful activities, earning XP, and competing with friends through visible progress.

## About 

BeBetter is a web platform that allows users to track meaningful daily activities through a daily planner.
For each completed activity, users receive a deserved amount of XP based on effort and difficulty. Progress is transparent, measurable, and earned.

BeBetter introduces a social layer that encourages accountability among users. Daily activities are public to friends, and a leaderboard ranks users based on their performance. This creates positive competition and reinforces consistency and discipline.

## Features

 ### Interactive planner
- Visual day view (hourly slots from 00:00 to 23:00).
- Clicking an empty slot opens a form to add an activity.
- Visual activity blocks.

 ### Leaderboard
 - Users ranked by XP earned in different time periods (Daily, Weekly, Monthly, All-Time).
 - Live Delta: shows position changes (e.g. show +2 if you climbed 2 spots compared to yesterday / last week / last month).
 - Rank ties: when you have same XP as your friend, you share a rank.

### XP System
- XP is automatically calculated on server (XP = Duration(min) * Activity-Type * Intensity

## Project Status
Active Development  

Core Daily Planner, XP system, Leaderboard and ranking logic implemented.  

## Technology

- **Language:** Clojure (Leiningen)
- **Database:** Datomic Pro  
- **Frontend:** HTMX, Hiccup  
- **Server:** Ring, Reitit, Jetty  
- **Testing:** clojure.test  
- **Validation:** Malli  

## Getting Started

#### Prerequisites
- Java JDK (8 or newer)
- Leiningen (Clojure build tool)
- Datomic Pro files (unzipped locally)

### Running the Application

Since Datomic is used, two services must be started:

1. Start Datomic transactor
2. Run the Clojure application

#### Start Datomic
In repository where Datomic Pro is Unzipped, run CMD
```bash
bin/transactor config/dev-transactor.properties
```
> [!NOTE] 
> Wait until you see "System started"
#### Run the Application
```bash
lein clean
lein run
```

## Authors

#### Dimitrije Mitić

**Master Student of Faculty of Organizational Sciences**

*Software Engineering and Artificial Intelligence*
