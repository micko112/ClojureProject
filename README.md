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

## Usage 

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
Once the server is running, open your web browser and navigate to:
http://localhost:3000

### 1. The Daily Planner
Upon loading the application, you are presented with the Interactive Planner.
- Timeline: The center of the screen shows a vertical timeline of the current day (00:00 - 23:00).
- Navigation: Click on dates in navbar to view activities on different dates.
- 
### 2. Logging an Activity
To log a completed activity:
1. Click on any empty time slot in the calendar (e.g. 14:00)
2. A form will apear in that slot
3. Select details:
   - Activity Type (e.g. Training, Study).
   - Intensity: Rate how hard you worked (1-5).
   - Duration: Put how long the activity lasted.
4. Click Save.
5. The activity will be visible over selected time slot painted with blue color 

### 3. The Leaderboard
> [!NOTE] 
> Soon to be publsihed.

## Developement

### Technology

- **Language:** Clojure (Leiningen)
- **Database:** Datomic Pro  
- **Frontend:** HTMX, Hiccup  
- **Server:** Ring, Reitit, Jetty  
- **Testing:** clojure.test  
- **Validation:** Malli  

### Prerequisites
- Java JDK (8 or newer)
- Leiningen (Clojure build tool)
- Datomic Pro files (unzipped locally)

### File Structure 

```text
src/
  ├── database/
  │   ├── schema.clj       
  │   └── seed.clj          
  │
  ├── project/
  │   ├── api.clj     
  │   ├── db.clj             
  │   ├── leaderboard.clj    
  │   ├── system.clj         
  │   ├── time.clj          
  │   └── validation.clj     
  │
  └── web/
      └── server.clj        
```

## Authors

#### Dimitrije Mitić

**Master Student of Faculty of Organizational Sciences**

*Software Engineering and Artificial Intelligence*

