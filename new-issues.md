- through ball - passer chasing a loose ball issue;

example sequence;

    ACTION.CHOICE — David Beckham chooses to through to Wayne Rooney · 9 legal pass options
    P.THROUGH — David Beckham slides a through ball into the space for Wayne Rooney, but nobody gets there
    ATT.RECEIVER.RUN — Wayne Rooney chases the delivery
    Movement timing
    P.RECEIVE.LATE — Wayne Rooney cannot reach the delivery before it runs loose
    Attribute influence
    ATT.ADJUST — Owen Hargreaves drops deep to offer a link; Danny Murphy holds the width; Michael Owen offers a short passing lane; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Paul Scholes pins the last line
    Movement timing
    GK.ADJUST — David James holds the goalkeeper line
    Movement timing
    RESTART.GOAL_KICK — David Beckham puts it out for a goal kick
    ATT.ADJUST — Owen Hargreaves offers a short passing lane; Danny Murphy holds the width; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Paul Scholes pins the last line; Michael Owen pins the last line
    Movement timing


in this particular scenario. When the passer (beckham in this case) tries a through ball and the ball is not met with the intended teammate, the passer runs after the ball until it goes out.

another example for that particular issue;

    P.RECEIVE.CLEAN — Michael Owen controls it cleanly
    Movement timing
    ATT.ADJUST — Danny Murphy holds the width; Wayne Rooney runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
    GK.ADJUST — David James holds the goalkeeper line
    ACTION.CHOICE — Michael Owen chooses to through to Wayne Rooney · 9 legal pass options
    P.THROUGH — Michael Owen slides a through ball into the space for Wayne Rooney, but nobody gets there
    ATT.RECEIVER.RUN — Wayne Rooney chases the delivery
    Movement timing
    P.RECEIVE.LATE — Wayne Rooney cannot reach the delivery before it runs loose
    Attribute influence
    ATT.ADJUST — Owen Hargreaves drops deep to offer a link; David Beckham offers a short passing lane; Danny Murphy holds the width; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Paul Scholes pins the last line
    Movement timing
    GK.ADJUST — David James holds the goalkeeper line
    Movement timing
    RESTART.THROW_IN — Michael Owen puts it out for a throw-in
    ATT.ADJUST — Glen Johnson holds the width; Owen Hargreaves drops deep to offer a link; Danny Murphy offers a short passing lane; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Paul Scholes pins the last line; David Beckham pins the last line
    Movement timing

This makes the game unplayable.

also a follow up for this case, why does the ball go out everytime this happens? Why doesn't ball lose momentum progressively?


- full speed denied issue, why?

given this particular sequence where I put 11 home players and none away players;

P.RECEIVE.CLEAN — Wayne Rooney controls it cleanly
Movement timing
ATT.ADJUST — Paul Scholes repositions; David Beckham repositions; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Michael Owen pins the last line
GK.ADJUST — David James holds the goalkeeper line
ACTION.CHOICE — Wayne Rooney chooses to carry · 9 legal pass options
P.CARRY.START — Wayne Rooney sets off at full sprint
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY — Wayne Rooney sprints into space
Attribute influence
Movement timing
ATT.ADJUST — Owen Hargreaves drops deep to offer a link; David Beckham runs in behind; Danny Murphy holds the width; Michael Owen offers a short passing lane; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Paul Scholes pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line
Movement timing
ACTION.CHOICE — Wayne Rooney chooses to carry · 9 legal pass options
P.CARRY.START — Wayne Rooney sets off at full sprint
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY — Wayne Rooney sprints into space
Attribute influence
Movement timing
ATT.ADJUST — David Beckham runs in behind; Danny Murphy holds the width; Michael Owen offers a short passing lane; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Paul Scholes pins the last line; Owen Hargreaves pins the last line
Movement timing
ACTION.CHOICE — Wayne Rooney chooses to carry · 9 legal pass options
P.CARRY.GAIT — Wayne Rooney: full-sprint denied (burst 34%), controlled-sprint
P.CARRY.START — Wayne Rooney sets off, pushing into space
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY.TOUCH — Wayne Rooney touches it forward
Attribute influence
Movement timing
P.CARRY — Wayne Rooney drives forward under control
Attribute influence
Movement timing
ATT.ADJUST — David Beckham runs in behind; Danny Murphy holds the width; Michael Owen offers a short passing lane; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Glen Johnson pins the last line; Paul Scholes pins the last line; Owen Hargreaves pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line
Movement timing
ACTION.CHOICE — Wayne Rooney chooses to shoot · 9 legal pass options
CALM — Wayne Rooney goes for a calm finish
F.CALM — On target
EMPTY_NET — Wayne Rooney finishes into an empty net -- no goalkeeper placed
ATT.ADJUST — Glen Johnson holds the width; David Beckham runs in behind; Danny Murphy attacks the box; Jamie Carragher pins the last line; Ashley Cole pins the last line; John Terry pins the last line; Paul Scholes pins the last line; Owen Hargreaves pins the last line
Movement timing


Why didn't Rooney run at full speed? What held him?

3rd issue - congested play, results a short pass loop. which also results teammates to clash into each other but still passing to each other

P.PASS.LOST — Danny Murphy intercepts
Movement timing
ATT.ADJUST — Bixente Lizarazu runs in behind; Zinedine Zidane moves diagonally inside; Sidney Govou moves diagonally inside; David Trezeguet offers a short passing lane; Willy Sagnol holds the width; Lilian Thuram pins the last line; Michaël Silvestre pins the last line; Claude Makelele pins the last line; Thierry Henry pins the last line
GK.ADJUST — Fabien Barthez holds the goalkeeper line; David James holds the goalkeeper line
DEF.ADJUST — John Terry tracks a runner; Glen Johnson tracks a runner; David Beckham tracks a runner; Jamie Carragher shifts with the unit; Owen Hargreaves shifts with the unit; Paul Scholes screens the danger; Wayne Rooney repositions; Michael Owen screens the danger
DEF.ADJUST — Sylvain Wiltord tracks back after losing it
Movement timing
ATT.ADJUST — Ashley Cole joins the attack from deep
Movement timing
ACTION.CHOICE — Danny Murphy chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — Danny Murphy plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole moves diagonally inside; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole moves diagonally inside; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to hold · 9 legal pass options
P.HOLD — Paul Scholes holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole moves diagonally inside; Danny Murphy offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Paul Scholes chooses to pass to Jamie Carragher · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass into the space ahead of Jamie Carragher
ATT.ADJUST — Ashley Cole moves diagonally inside; David Beckham drops deep to offer a link; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry screens the danger
Movement timing
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — Ashley Cole moves diagonally inside; David Beckham drops deep to offer a link; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry screens the danger
ACTION.CHOICE — Jamie Carragher chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — Ashley Cole moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — Ashley Cole moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to pass to David Beckham · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass into the space ahead of David Beckham
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole moves diagonally inside; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; John Terry pins the last line; Owen Hargreaves pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Thierry Henry presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
Movement timing
P.RECEIVE.CLEAN — David Beckham controls it cleanly
Movement timing
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; John Terry pins the last line; Owen Hargreaves pins the last line; Michael Owen pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
ACTION.CHOICE — David Beckham chooses to hold · 9 legal pass options
P.HOLD — David Beckham holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry offers a short passing lane; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; Paul Scholes pins the last line; Owen Hargreaves pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
Movement timing
ACTION.CHOICE — David Beckham chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — David Beckham plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; John Terry pins the last line; Owen Hargreaves pins the last line; Michael Owen pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; Michael Owen pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to hold · 9 legal pass options
P.HOLD — Paul Scholes holds the ball, looking for support
ATT.ADJUST — Jamie Carragher offers a short passing lane; Ashley Cole runs in behind; John Terry moves diagonally inside; Owen Hargreaves drops deep to offer a link; Danny Murphy moves diagonally inside; Wayne Rooney moves diagonally inside; David Beckham pins the last line; Michael Owen pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Paul Scholes chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass into the space ahead of Danny Murphy
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Sylvain Wiltord presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
Movement timing
P.RECEIVE.CLEAN — Danny Murphy controls it cleanly
Movement timing
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — Sylvain Wiltord presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
ACTION.CHOICE — Danny Murphy chooses to hold · 9 legal pass options
P.HOLD — Danny Murphy holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Sylvain Wiltord presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
Movement timing
ACTION.CHOICE — Danny Murphy chooses to pass to Jamie Carragher · 9 legal pass options
P.PASS — Danny Murphy plays a ground pass into the space ahead of Jamie Carragher
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes drops deep to offer a link; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes drops deep to offer a link; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Jamie Carragher chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Owen Hargreaves pins the last line; Michael Owen pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Owen Hargreaves pins the last line; Michael Owen pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to pass to Jamie Carragher · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass into the space ahead of Jamie Carragher
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Danny Murphy drops deep to offer a link; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Danny Murphy drops deep to offer a link; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Jamie Carragher chooses to pass to David Beckham · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass into the space ahead of David Beckham
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes repositions; Owen Hargreaves pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
Movement timing
P.RECEIVE.CLEAN — David Beckham controls it cleanly
Movement timing
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes repositions; Owen Hargreaves pins the last line; Michael Owen pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
ACTION.CHOICE — David Beckham chooses to hold · 9 legal pass options
P.HOLD — David Beckham holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; Danny Murphy pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
Movement timing
ACTION.CHOICE — David Beckham chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — David Beckham plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; Danny Murphy pins the last line; Michael Owen pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; Danny Murphy pins the last line; Michael Owen pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to hold · 9 legal pass options
P.HOLD — Paul Scholes holds the ball, looking for support
ATT.ADJUST — Jamie Carragher offers a short passing lane; Ashley Cole runs in behind; John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; Danny Murphy pins the last line; Michael Owen pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Paul Scholes chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass into the space ahead of Danny Murphy
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Sylvain Wiltord presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
Movement timing
P.RECEIVE.CLEAN — Danny Murphy controls it cleanly
Movement timing
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; David Beckham pins the last line; Michael Owen pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — Sylvain Wiltord presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
ACTION.CHOICE — Danny Murphy chooses to pass to David Beckham · 9 legal pass options
P.PASS — Danny Murphy plays a ground pass into the space ahead of David Beckham
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Jamie Carragher pins the last line; Owen Hargreaves pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
Movement timing
P.RECEIVE.CLEAN — David Beckham controls it cleanly
Movement timing
ATT.ADJUST — Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Jamie Carragher pins the last line; Owen Hargreaves pins the last line; Michael Owen pins the last line
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
ACTION.CHOICE — David Beckham chooses to hold · 9 legal pass options
P.HOLD — David Beckham holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Owen Hargreaves pins the last line; Danny Murphy pins the last line; Michael Owen pins the last line
Movement timing
DEF.ADJUST — Thierry Henry presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; David Trezeguet screens the danger
Movement timing
ACTION.CHOICE — David Beckham chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — David Beckham plays a ground pass into the space ahead of Danny Murphy
ATT.ADJUST — Jamie Carragher drops deep to offer a link; Ashley Cole runs in behind; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Paul Scholes pins the last line; Owen Hargreaves pins the last line; Michael Owen pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Sylvain Wiltord presses the ball; Willy Sagnol repositions; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
Movement timing
P.RECEIVE.CLEAN — Danny Murphy controls it cleanly
Movement timing
ATT.ADJUST — Jamie Carragher drops deep to offer a link; John Terry moves diagonally inside; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Paul Scholes pins the last line; Owen Hargreaves pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — Sylvain Wiltord presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
ACTION.CHOICE — Danny Murphy chooses to hold · 9 legal pass options
P.HOLD — Danny Murphy holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — Sylvain Wiltord presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sidney Govou screens the danger; Thierry Henry repositions; David Trezeguet screens the danger
Movement timing
ACTION.CHOICE — Danny Murphy chooses to pass to David Beckham · 9 legal pass options
P.PASS — Danny Murphy plays a ground pass into the space ahead of David Beckham
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — David Beckham controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — David Beckham chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — David Beckham plays a ground pass into the space ahead of Danny Murphy
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Danny Murphy controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Danny Murphy chooses to hold · 9 legal pass options
P.HOLD — Danny Murphy holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Danny Murphy chooses to pass to David Beckham · 9 legal pass options
P.PASS — Danny Murphy plays a ground pass into the space ahead of David Beckham
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — David Beckham controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — David Beckham chooses to hold · 9 legal pass options
P.HOLD — David Beckham holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — David Beckham chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — David Beckham plays a ground pass into the space ahead of Danny Murphy
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Danny Murphy controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Jamie Carragher pins the last line; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Danny Murphy chooses to hold · 9 legal pass options
P.HOLD — Danny Murphy holds the ball, looking for support
ATT.ADJUST — Jamie Carragher drops deep to offer a link; John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Danny Murphy chooses to pass to Jamie Carragher · 9 legal pass options
P.PASS — Danny Murphy plays a ground pass into the space ahead of Jamie Carragher
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
Movement timing
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes offers a short passing lane; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
GK.ADJUST — David James holds the goalkeeper line; Fabien Barthez holds the goalkeeper line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Jamie Carragher chooses to pass to David Beckham · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass toward David Beckham, but Paul Scholes gets to it
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass toward Danny Murphy, but Jamie Carragher gets to it
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Jamie Carragher chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to hold · 9 legal pass options
P.HOLD — Paul Scholes holds the ball, looking for support
ATT.ADJUST — Jamie Carragher offers a short passing lane; John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Paul Scholes chooses to pass to David Beckham · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass toward David Beckham, but Jamie Carragher gets to it
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Jamie Carragher chooses to pass to David Beckham · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass toward David Beckham, but Paul Scholes gets to it
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to hold · 9 legal pass options
P.HOLD — Paul Scholes holds the ball, looking for support
ATT.ADJUST — Jamie Carragher offers a short passing lane; John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Paul Scholes chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass toward Danny Murphy, but Jamie Carragher gets to it
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Jamie Carragher chooses to hold · 9 legal pass options
P.HOLD — Jamie Carragher holds the ball, looking for support
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes repositions; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Jamie Carragher chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Paul Scholes chooses to hold · 9 legal pass options
P.HOLD — Paul Scholes holds the ball, looking for support
ATT.ADJUST — Jamie Carragher offers a short passing lane; John Terry moves diagonally inside; Danny Murphy drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; David Beckham pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Paul Scholes chooses to pass to Danny Murphy · 9 legal pass options
P.PASS — Paul Scholes plays a ground pass toward Danny Murphy, but Jamie Carragher gets to it
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Jamie Carragher controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; David Beckham drops deep to offer a link; Wayne Rooney moves diagonally inside; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line; Danny Murphy pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
ACTION.CHOICE — Jamie Carragher chooses to hold · 9 legal pass options
P.HOLD — Jamie Carragher holds the ball, looking for support
ATT.ADJUST — John Terry moves diagonally inside; Paul Scholes repositions; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
Movement timing
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
Movement timing
ACTION.CHOICE — Jamie Carragher chooses to pass to Paul Scholes · 9 legal pass options
P.PASS — Jamie Carragher plays a ground pass into the space ahead of Paul Scholes
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
P.RECEIVE.CLEAN — Paul Scholes controls it cleanly
Movement timing
ATT.ADJUST — John Terry moves diagonally inside; David Beckham repositions; Danny Murphy repositions; Michael Owen runs in behind; Ashley Cole pins the last line; Owen Hargreaves pins the last line
DEF.ADJUST — David Trezeguet presses the ball; Bixente Lizarazu tracks a runner; Lilian Thuram tracks a runner; Claude Makelele tracks a runner; Willy Sagnol tracks a runner; Michaël Silvestre shifts with the unit; Zinedine Zidane screens the danger; Sylvain Wiltord screens the danger; Sidney Govou screens the danger; Thierry Henry repositions
POSSESSION.MAX_ACTIONS — Live sequence capped at 50 actions


why does this happen? We might need to add ball velocity and coordinates as well as player involved's coordinates and pass force to the logs.

we should I guess implement a point system to some actions and this kind of repetitive very short passing should be discouraged maybe?

I mean it is only useful (not clashing into each other or coming and bumping into each other and passing) if there is a need of time wasting. Which is yet to be implemented.